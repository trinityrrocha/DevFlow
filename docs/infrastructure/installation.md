# Arquitetura de instalação e coexistência

## Contrato do instalador

O entrypoint da raiz encaminha para `scripts/install.sh`. Ambos usam Bash estrito (`set -Eeuo pipefail`) e são somente leitura por padrão.

Para instalação pública sem clone prévio, `scripts/bootstrap.sh` é o entrypoint standalone. Ele baixa a `main` em diretório temporário, valida origem, commit e `VERSION`, e então chama o mesmo instalador interno; não duplica a lógica de instalação.

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
- domínio, e-mail TLS, e-mail do Super Admin e modo de proxy explícitos.

Outras plataformas falham de forma segura. A matriz ainda precisa de ensaio automatizado antes de produção.

## Servidor limpo

Docker é instalado somente se ausente e exclusivamente pelo repositório oficial. O instalador cria recursos do projeto `devflow`, configuração privada, banco, migration, aplicação, HTTPS, healthchecks e backup agendado. Não altera firewall nem configurações globais não relacionadas.

## Infraestrutura existente

Docker e Compose compatíveis são reutilizados. O instalador verifica nomes, labels de propriedade, redes, volumes e portas. Recursos com namespace DevFlow mas sem a label esperada causam parada. Nenhum container de terceiros é parado ou reiniciado.

No modo compartilhado, um diagnóstico read-only precisa comprovar o contrato inteiro antes de qualquer mutação. Um Nginx do host compatível recebe um único arquivo gerenciado e usa portas loopback. O inventário exato aprovado do `fullpassword_nginx` usa o adaptador por Compose override e rede externa; outras topologias permanecem bloqueadas. No modo isolado, 80/443 precisam estar livres.

## Full Password

O container `fullpassword_nginx` continua sendo um limite de segurança. A instalação só avança quando projeto, serviço, working directory, Compose, mounts read-only, rede original, include, domínio, propriedade da rede de borda e merge final coincidem com o contrato aprovado. O resultado é `compatible-with-compose-override`; qualquer divergência bloqueia.

O ensaio real do commit `4d350685cbc9d21b49fb4c01176b846ca66d6584` parou nesse gate, antes de qualquer integração. Esse evento comprova o fail-closed, não a compatibilidade.

O adaptador cria apenas `/opt/fullpassword/docker-compose.devflow.yml`, `/opt/devflow/config/nginx/devflow.conf` e a rede externa `devflow_edge`. O Compose original e `nginx.runtime.conf` não são editados. O certificado DevFlow é independente; o serviço `nginx` é o único componente Full Password recriado, sempre com os dois arquivos Compose e com rollback. Veja o [contrato completo do adaptador](fullpassword-nginx-adapter.md) e o [guia de VPS](vps-installation.md).

## Recursos próprios

- projeto Compose: `devflow`;
- diretório: `/opt/devflow`;
- banco: `/opt/devflow/data/postgres`;
- uploads: `/opt/devflow/storage/uploads`;
- configuração: `/opt/devflow/config/devflow.env`;
- checkout operacional: `/opt/devflow/source`;
- backups: `/opt/devflow/backups`;
- proxy do host: `/etc/nginx/conf.d/devflow.conf`;
- proxy Full Password: `/opt/devflow/config/nginx/devflow.conf` e override `/opt/fullpassword/docker-compose.devflow.yml`;
- relatório de proxy compartilhado: `/var/log/devflow/shared-proxy-diagnostic.log`;
- redes: `devflow_edge` para borda e `devflow_internal` para PostgreSQL/backend;
- containers gerados pelo Compose: prefixo previsível `devflow-`.

Não são definidos `container_name` globais: os nomes derivados do projeto Compose evitam colisão e preservam escalabilidade.

## Idempotência e reversibilidade

Uma instalação existente exige o updater dedicado; o instalador nunca sobrescreve `app`. Arquivos gerenciados carregam marcador de propriedade. Releases são diretórios imutáveis por SHA. O checkout operacional pertence a root, tem hooks desabilitados, usa HTTPS público sem credenciais e não é ambiente de desenvolvimento.

O rollback transacional de dados, release e containers pertence ao updater. O instalador possui somente a restauração local necessária para uma troca atômica de `devflow.conf`. A aplicação continua classificada como alpha porque instalação e recuperação ainda precisam de laboratório Linux reproduzível.
