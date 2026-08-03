# Arquitetura de instalação e coexistência

> Atualização `0.4.0-alpha`: `host-nginx` é o provider padrão. O instalador delega proxy/TLS ao contrato em [providers](providers.md), publica a aplicação em loopback e registra o provider em `/opt/devflow/state/infrastructure-provider.json`. O adaptador do `fullpassword_nginx` é legado e nunca é escolhido automaticamente.

## Contrato do instalador

O entrypoint da raiz encaminha para `scripts/install.sh`. Ambos usam Bash estrito (`set -Eeuo pipefail`) e são somente leitura por padrão.

Para instalação pública sem clone prévio, `scripts/bootstrap.sh` é o entrypoint standalone. Ele baixa `main` ou uma tag `vSEMVER` em diretório temporário, valida origem, referência, commit, arquivos rastreados e consistência da versão, e então chama o mesmo instalador interno. Em `main`, não existe constante de versão; `--expected-version` é opcional e explícito.

| Modo | Efeito |
|---|---|
| sem argumento / `--check` | diagnóstico sem mutação |
| `--dry-run` | valida entradas e exibe o plano |
| `--install` | primeira instalação, após confirmação |

O instalador rejeita uma instalação existente. Toda atualização pertence exclusivamente a `scripts/update.sh`.

No bootstrap baixado, a ausência de modo abre o fluxo interativo de instalação. No instalador interno e no launcher do repositório, a ausência de modo permanece equivalente a `--check`.

O fluxo é `detectar → validar → resumir → confirmar → aplicar → verificar → promover`. Qualquer incompatibilidade antes da confirmação interrompe a execução. Depois que a aplicação começa, falhas removem apenas o link candidato e registram relatório; dados existentes são preservados.

## Plataformas e requisitos

- Ubuntu 22.04/24.04 e Debian 12/13;
- `amd64` e `arm64`;
- Docker Engine 24+ e Compose v2 2.20+;
- 2 GiB de RAM e 5 GiB livres;
- domínio, e-mail TLS e e-mail do Super Admin; o provider padrão é `host-nginx` e `--provider isolated-nginx` é uma opção explícita para VPS exclusiva.

Outras plataformas falham de forma segura. A matriz ainda precisa de ensaio automatizado antes de produção.

## Servidor limpo

Docker é instalado somente se ausente e exclusivamente pelo repositório oficial. O instalador cria recursos do projeto `devflow`, configuração privada, banco, migration, aplicação, HTTPS, healthchecks e backup agendado. Não altera firewall nem configurações globais não relacionadas.

## Infraestrutura existente

Docker e Compose compatíveis são reutilizados. O instalador verifica nomes, labels de propriedade, redes, volumes e portas. Recursos com namespace DevFlow mas sem a label esperada causam parada. Nenhum container de terceiros é parado ou reiniciado.

O Nginx do host recebe somente o virtual host DevFlow e usa upstreams loopback. Se `fullpassword_nginx` ocupar 80/443, o instalador interrompe e aponta para a [migração separada](proxy-migration.md); não lê nem reconcilia o Compose do outro projeto. No provider isolado, 80/443 precisam estar livres.

`--check` não executa a composição completa: ele identifica inputs protegidos e pode retornar `check_status=passed-with-privileged-dry-run-required`. `--dry-run` executa a validação completa somente se o processo puder ler todos os inputs. Quando isso exigir root, o modo comum encerra sem alterações e fornece o comando com `sudo`. Mesmo como root, o dry-run termina antes de qualquer código de instalação e usa somente temporários sob `/tmp`.

## Full Password

O container `fullpassword_nginx` continua sendo um limite de segurança. A instalação só avança quando projeto, serviço, working directory, Compose, mounts read-only, rede original, include, domínio, propriedade da rede de borda e merge final coincidem com o contrato aprovado. O resultado é `compatible-with-compose-override`; qualquer divergência bloqueia.

O check real da versão `0.3.2-alpha`, commit `be1636861505d4f8bedbd42e84d3d66eb70f6fad`, detectou o input protegido, mas o dry-run encontrou `FULLPASSWORD_COMPOSE_FILE` não inicializada. Em `0.3.3-alpha`, labels, working directory, fallback, existência e legibilidade são validados por funções independentes antes do inventário. A validação privilegiada permanece pendente.

O adaptador cria apenas artefatos sob `/opt/devflow`, incluindo `/opt/devflow/config/proxy/fullpassword-nginx.override.yml` e `/opt/devflow/config/nginx/devflow.conf`, além da rede externa `devflow_edge`. O Compose original e `nginx.runtime.conf` são somente leitura. O certificado DevFlow é independente; o serviço `nginx` é o único componente Full Password reconciliado, sempre com os dois arquivos Compose e com rollback. Veja o [contrato completo do adaptador](fullpassword-nginx-adapter.md) e o [guia de VPS](vps-installation.md).

O Docker Compose pode precisar de `/opt/fullpassword/.env` e de `env_file` adicionais para interpolar a configuração original. Esses arquivos são inputs opacos: somente o processo `docker compose --project-directory /opt/fullpassword` pode consumi-los. O DevFlow registra caminhos e estados de legibilidade, nunca conteúdo ou valores interpolados.

## Recursos próprios

- projeto Compose: `devflow`;
- diretório: `/opt/devflow`;
- banco: `/opt/devflow/data/postgres`;
- uploads: `/opt/devflow/storage/uploads`;
- configuração: `/opt/devflow/config/devflow.env`;
- checkout operacional: `/opt/devflow/source`;
- backups: `/opt/devflow/backups`;
- proxy do host: `/etc/nginx/sites-available/devflow.conf` e link em `sites-enabled` (fallback `/etc/nginx/conf.d/devflow.conf`);
- proxy Full Password: `/opt/devflow/config/nginx/devflow.conf` e override `/opt/devflow/config/proxy/fullpassword-nginx.override.yml`;
- estado operacional: `/opt/devflow/state/installation.json`, `version.json` e `infrastructure-provider.json`; `proxy-adapter.json` permanece apenas para o provider legado;
- relatório de proxy compartilhado: `/opt/devflow/logs/shared-proxy-diagnostic.log`;
- redes: `devflow_edge` para borda e `devflow_internal` para PostgreSQL/backend;
- containers gerados pelo Compose: prefixo previsível `devflow-`.

Não são definidos `container_name` globais: os nomes derivados do projeto Compose evitam colisão e preservam escalabilidade.

## Idempotência e reversibilidade

Uma instalação existente exige o updater dedicado; o instalador nunca sobrescreve `app`. Arquivos gerenciados carregam marcador de propriedade. Releases são diretórios imutáveis por SHA. O checkout operacional pertence a root, tem hooks desabilitados, usa HTTPS público sem credenciais e não é ambiente de desenvolvimento.

O rollback transacional de dados, release e containers pertence ao updater. O instalador possui somente a restauração local necessária para uma troca atômica de `devflow.conf`. A aplicação continua classificada como alpha porque instalação e recuperação ainda precisam de laboratório Linux reproduzível.
