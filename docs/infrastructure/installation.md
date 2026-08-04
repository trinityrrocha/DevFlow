# Arquitetura de instalação e coexistência

> Atualização `0.4.0-alpha`: `host-nginx` é o provider padrão. O instalador delega proxy/TLS ao contrato em [providers](providers.md), publica a aplicação em loopback e registra o provider em `/opt/devflow/state/infrastructure-provider.json`. O adaptador do `fullpassword_nginx` é legado e nunca é escolhido automaticamente.

## Contrato do instalador

O entrypoint da raiz encaminha para `scripts/install.sh`. Ambos usam Bash estrito (`set -Eeuo pipefail`) e são somente leitura por padrão.

## Estágios independentes

`--install-internal` instala código, configuração privada, PostgreSQL, migrations, backend, frontend, Super Admin, backup e health local. Frontend e backend usam somente `127.0.0.1`; esse estágio não chama funções mutáveis do provider.

`scripts/publish.sh` é o estágio externo posterior. Sem modo, ele apenas verifica. `--publish` exige estado interno saudável, valida DNS e propriedade de 80/443, configura o provider, emite TLS e confirma HTTPS; `--rollback` restaura o pacote persistente da última publicação. Não reinstala a release e não executa migrations.

`--install` continua significando instalação completa. Se um proxy Docker conhecido ocupar 80/443, o instalador apresenta explicitamente instalar internamente, cancelar ou consultar a migração; nenhuma opção é escolhida automaticamente.

Para instalação pública sem clone prévio, `scripts/bootstrap.sh` é o entrypoint standalone. Ele baixa `main` ou uma tag `vSEMVER` em diretório temporário, valida origem, referência, commit, arquivos rastreados e consistência da versão, e então chama o mesmo instalador interno. Em `main`, não existe constante de versão; `--expected-version` é opcional e explícito.

| Modo | Efeito |
|---|---|
| sem argumento / `--check` | diagnóstico sem mutação |
| `--dry-run` | valida entradas e exibe o plano |
| `--install` | primeira instalação, após confirmação |
| `--resume` | retoma somente uma instalação interna parcial comprovadamente compatível |

O instalador rejeita uma instalação concluída. Toda atualização pertence exclusivamente a `scripts/update.sh`; `--resume` não atualiza instalações concluídas e só aceita um checkout parcial limpo, canônico e compatível por fast-forward.

No bootstrap baixado, a ausência de modo abre o fluxo interativo de instalação. No instalador interno e no launcher do repositório, a ausência de modo permanece equivalente a `--check`.

O fluxo é `detectar → validar → resumir → confirmar → aplicar → verificar → promover`. As 14 etapas são gravadas atomicamente em `/opt/devflow/state/install-transaction.json`. Qualquer incompatibilidade antes da confirmação interrompe a execução. Depois que a aplicação começa, falhas removem apenas recursos incompletos do DevFlow e registram relatório; checkout, configuração, imagens válidas e dados são preservados.

Antes dos imports, o instalador cria um logger temporário 0600 e instala traps sanitizados. Uma tentativa legada sem estado transacional é reconstruída inicialmente em memória; o dry-run não grava `/opt/devflow/state`, e `--resume` só persiste o estado após a escolha `1 - RETOMAR INSTALAÇÃO DO DEVFLOW`. O clone invocador é somente leitura, com locks opcionais do Git desativados e assinatura de `.git/index` conferida antes de qualquer aplicação.

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

Para os próprios serviços, o DevFlow monta todo comando por `build_devflow_compose_command`. O construtor exige raiz e env absolutos, Compose regular e legível e `/opt/devflow/config/devflow.env` regular, não simbólico, legível, com modo `0400` ou `0600` e proprietário confiável. `config`, build, pull, up, run, exec, health, update, backup, restore, rollback e uninstall reutilizam o mesmo array com `--env-file`; o arquivo dotenv nunca é executado como shell.

Antes da criação da configuração privada, somente a estrutura Compose é validada com um arquivo temporário `0600` contendo placeholders não secretos. Esse arquivo não é persistido, não copia o env real e nunca é usado para iniciar containers.

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
- estado operacional: `/opt/devflow/state/installation.json`, `install-transaction.json`, `version.json` e `infrastructure-provider.json`; `proxy-adapter.json` permanece apenas para o provider legado. `installation.json` usa schema canônico v2 exato, gravação atômica e modo `0600` com propriedade `root:root`;
- relatório de proxy compartilhado: `/opt/devflow/logs/shared-proxy-diagnostic.log`;
- redes: `devflow_edge` para borda e `devflow_internal` para PostgreSQL/backend;
- containers gerados pelo Compose: prefixo previsível `devflow-`.

Não são definidos `container_name` globais: os nomes derivados do projeto Compose evitam colisão e preservam escalabilidade.

## Idempotência e reversibilidade

Uma instalação concluída exige o updater dedicado; o instalador nunca sobrescreve `app`. Uma tentativa parcial pode ser retomada explicitamente, mas não é promovida até migration, serviços, bootstrap e health serem confirmados. Imagens são obtidas do Compose resolvido, validadas por `docker image inspect` e reutilizadas somente quando rótulos de versão/commit comprovam a release. Arquivos gerenciados carregam marcador de propriedade. Releases são diretórios imutáveis por SHA. O checkout operacional pertence a root, tem hooks desabilitados, usa HTTPS público sem credenciais e não é ambiente de desenvolvimento.

O rollback transacional de dados, release e containers pertence ao updater. O instalador possui somente a restauração local necessária para uma troca atômica de `devflow.conf`. A aplicação continua classificada como alpha porque instalação e recuperação ainda precisam de laboratório Linux reproduzível.
