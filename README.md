# DevFlow

Plataforma multi-tenant de governança do desenvolvimento. Cada tarefa é tratada como um dossiê técnico: solicitação, execução, testes, aprovações, artefatos GitHub, histórico, auditoria e métricas permanecem relacionados e rastreáveis.

> **O DevFlow encontra-se em fase de homologação e ainda não foi aprovado para uso em produção.**

Versão atual: **0.3.0-alpha**. Os Documentos 001, 002 e 003 formam a baseline. O mecanismo operacional de atualização e o adaptador de proxy compartilhado ainda dependem de homologação em VPS e não representam aprovação para produção.

## Estado atual

A baseline inclui backend Node.js/Express, frontend React/Vite, PostgreSQL, migration inicial, autenticação com sessão protegida, MFA TOTP, RBAC multi-tenant, domínio de tarefas, auditoria, Docker Compose, backup criptografado e atualização transacional para homologação.

Ainda dependem de homologação em Linux: instalação completa, emissão e renovação real de certificados, integração com PostgreSQL e containers, ensaios de backup/restauração e rollback induzido, E2E, acessibilidade, carga e pentest. Consulte o [estado de implementação](docs/implementation-status.md).

Nenhum código do Full Password foi reutilizado. A referência técnica permaneceu limpa no commit `804008b5df5d0931ec5d95227fed44086f430d76`; os padrões observados estão na [análise arquitetural](docs/architecture/fullpassword-analysis.md).

## Requisitos

- VPS Linux `amd64` ou `arm64` com Ubuntu 22.04/24.04 ou Debian 12/13;
- domínio exclusivo apontado para a VPS;
- pelo menos 2 GiB de RAM e 5 GiB livres;
- acesso `root` por `sudo`;
- portas 80/443 livres para o modo isolado; no compartilhado, Nginx do host com portas loopback livres ou o ambiente `fullpassword_nginx` estritamente compatível descrito abaixo;
- `python3` e `openssl` previamente disponíveis quando o diagnóstico read-only do `fullpassword_nginx` for utilizado;
- acesso HTTPS ao repositório público `trinityrrocha/DevFlow`.

Docker Engine 24+ e Docker Compose v2 2.20+ são instalados pelo repositório oficial somente quando ausentes.

## Instalação pública rápida para homologação

Não execute scripts remotos por pipe. Baixe o bootstrap, revise-o localmente e então execute:

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
sudo ./install.sh
```

O bootstrap sem argumentos valida Linux e conectividade, coleta domínio, e-mails e proxy, exige confirmação, cria um diretório temporário seguro, clona e valida a `main`, confere `VERSION` e commit remoto, chama `scripts/install.sh` e remove os temporários.

O fluxo explícito em três etapas também está disponível:

```bash
./install.sh --check
./install.sh --dry-run \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
sudo ./install.sh --install \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Parâmetros de configuração podem ser fornecidos ao bootstrap sem clone prévio:

```bash
sudo ./install.sh \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

`--check` e `--dry-run` não fazem instalação. No bootstrap baixado, a ausência de modo inicia o fluxo interativo; no launcher existente dentro do repositório, a ausência de modo continua equivalendo a `--check`.

O instalador cria `/opt/devflow/source` como checkout operacional root-only, sem hooks e com remote HTTPS público. Instalação e atualizações não utilizam token, deploy key, chave SSH ou autenticação GitHub.

O guia completo está em [instalação na VPS](docs/infrastructure/vps-installation.md).

## Modos de infraestrutura

- `DEVFLOW_PROXY_MODE=isolated`: instalação independente, recomendada para servidor limpo. Proxy, containers, redes, volumes, banco e certificados pertencem somente ao DevFlow.
- `DEVFLOW_PROXY_MODE=shared`: containers, volumes, banco e storage continuam exclusivos do DevFlow. Pode compartilhar um Nginx do host comprovadamente persistente ou, somente no contrato aprovado, o `fullpassword_nginx` por Compose override independente.

A rede `devflow_edge` contém somente frontend, backend e edge; `devflow_internal` é interna e contém somente PostgreSQL e backend. O proxy nunca recebe acesso à rede do banco.

A escolha é sempre explícita. No modo compartilhado, `scripts/detect-shared-proxy.sh` inventaria proxy, configuração, includes, mounts, redes, certificados e estratégia de aplicação sem alterá-los. Um `fullpassword_nginx` só recebe `compatibility=compatible-with-compose-override` quando coincide integralmente com o contrato aprovado de `/opt/fullpassword`; outros Nginx containerizados e Caddy continuam bloqueados. O relatório sanitizado fica em `/var/log/devflow/shared-proxy-diagnostic.log`.

Para o contrato aprovado, o instalador cria a rede externa `devflow_edge`, mantém o PostgreSQL apenas em `devflow_internal`, instala `/opt/fullpassword/docker-compose.devflow.yml` e monta somente `/opt/devflow/config/nginx/devflow.conf` no proxy. O Compose e a configuração originais do Full Password não são editados. Certificado, arquivos e recriação exclusiva do serviço `nginx` fazem parte de uma transação com backup e rollback. Consulte o [adaptador persistente](docs/infrastructure/fullpassword-nginx-adapter.md).

O primeiro ensaio real na VPS, usando `0.2.0-alpha` no commit `4d350685cbc9d21b49fb4c01176b846ca66d6584`, validou o bloqueio anterior e forneceu o inventário usado pelo adaptador. A implementação `0.3.0-alpha` ainda não foi ensaiada nessa VPS; portanto, o modo compartilhado não está homologado.

## Configuração

O contrato público está em [.env.example](.env.example). Na VPS, a configuração real fica fora do Git em `/opt/devflow/config/devflow.env`, modo `0600`. Os segredos são gerados com OpenSSL e nunca são exibidos integralmente.

Categorias disponíveis: aplicação, banco, autenticação, MFA, SMTP, storage, backup, proxy, domínio, HTTPS, logs, métricas e atualização. SMTP é opcional; preencha as variáveis no arquivo protegido e atualize somente os containers DevFlow.

## Primeiro Super Admin

O instalador vincula o bootstrap ao e-mail informado e armazena um token de uso inicial em `/opt/devflow/config/bootstrap-token`, modo `0600`. No primeiro acesso:

1. informe o e-mail autorizado e o token protegido;
2. crie uma senha forte, sem padrão fixo;
3. troque a credencial temporária quando solicitado;
4. configure MFA obrigatoriamente;
5. encerre as sessões temporárias.

O token não deve ser copiado para ticket, chat ou log. Remova-o do disco após confirmar o bootstrap.

## Operação

```bash
# diagnóstico sanitizado
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
sudo /opt/devflow/app/scripts/health.sh

# versão instalada e versão disponível
sudo /opt/devflow/app/scripts/version.sh --all --refresh

# backup manual criptografado
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/verify-backup.sh /opt/devflow/backups/devflow-ARQUIVO.dfbackup

# consultar sem alterar e depois atualizar com confirmação
sudo /opt/devflow/app/scripts/update.sh --check
sudo /opt/devflow/app/scripts/update.sh

# remover serviços e preservar todos os dados
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data

# remoção opcional do certificado DevFlow exige confirmação adicional
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data --remove-devflow-certificate

# purge exige backup e duas confirmações literais
sudo /opt/devflow/app/scripts/uninstall.sh --purge
```

O updater consulta exclusivamente `origin/main`, exibe changelog, exige backup validado, ativa manutenção, aplica migrations e promove a release somente após health checks. Falhas posteriores ao backup acionam restauração e retorno automático dos containers anteriores. O comportamento precisa ser comprovado por testes de falha na VPS antes de produção. Veja [atualização, backup e rollback](docs/infrastructure/update-backup-rollback.md).

## Desenvolvimento local

Requisitos: Node.js 20+ e pnpm 10+.

```bash
cp .env.example .env
# preencha somente a cópia ignorada pelo Git
pnpm install --frozen-lockfile
pnpm check
docker compose config --quiet
```

## Documentação

- [Arquitetura DevFlow](docs/architecture/devflow-architecture.md)
- [Modelo de dados](docs/architecture/data-model.md)
- [Documento 002](docs/functional/document-002.md)
- [Documento 003](docs/functional/document-003.md)
- [Infraestrutura](docs/infrastructure/infrastructure.md)
- [Instalação e coexistência](docs/infrastructure/installation.md)
- [Adaptador persistente para fullpassword_nginx](docs/infrastructure/fullpassword-nginx-adapter.md)
- [Instalação na VPS](docs/infrastructure/vps-installation.md)
- [Primeiro deployment](docs/operations/first-deployment.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Segurança](docs/security/security-baseline.md)
- [Padrões de desenvolvimento](docs/development/standards.md)
- [Roadmap](docs/roadmap.md)
- [Rastreabilidade](docs/traceability.md)
- [Changelog](CHANGELOG.md)

## Licenciamento

O repositório é público, mas nenhuma licença de software foi definida. A ausência de um arquivo `LICENSE` não concede permissão de uso, cópia, modificação ou redistribuição; aplicam-se os direitos autorais padrão. A decisão de licenciamento permanece pendente com o proprietário.
