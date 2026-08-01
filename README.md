# DevFlow

Plataforma multi-tenant de governança do desenvolvimento. Cada tarefa é tratada como um dossiê técnico: solicitação, execução, testes, aprovações, artefatos GitHub, histórico, auditoria e métricas permanecem relacionados e rastreáveis.

> **O DevFlow encontra-se em fase de homologação e ainda não foi aprovado para uso em produção.**

Versão atual: **0.2.0-alpha**. Os Documentos 001, 002 e 003 formam a baseline. O mecanismo operacional de atualização ainda depende de homologação em VPS e não representa aprovação para produção.

## Estado atual

A baseline inclui backend Node.js/Express, frontend React/Vite, PostgreSQL, migration inicial, autenticação com sessão protegida, MFA TOTP, RBAC multi-tenant, domínio de tarefas, auditoria, Docker Compose, backup criptografado e atualização transacional para homologação.

Ainda dependem de homologação em Linux: instalação completa, emissão e renovação real de certificados, integração com PostgreSQL e containers, ensaios de backup/restauração e rollback induzido, E2E, acessibilidade, carga e pentest. Consulte o [estado de implementação](docs/implementation-status.md).

Nenhum código do Full Password foi reutilizado. A referência técnica permaneceu limpa no commit `804008b5df5d0931ec5d95227fed44086f430d76`; os padrões observados estão na [análise arquitetural](docs/architecture/fullpassword-analysis.md).

## Requisitos

- VPS Linux `amd64` ou `arm64` com Ubuntu 22.04/24.04 ou Debian 12/13;
- domínio exclusivo apontado para a VPS;
- pelo menos 2 GiB de RAM e 5 GiB livres;
- acesso `root` por `sudo`;
- portas 80/443 livres para o modo isolado, ou Nginx do host e portas loopback livres para o modo compartilhado;
- acesso autenticado ao repositório privado `trinityrrocha/DevFlow`.

Docker Engine 24+ e Docker Compose v2 2.20+ são instalados pelo repositório oficial somente quando ausentes.

## Instalação rápida para homologação

Não execute scripts remotos por pipe. Clone o repositório privado por SSH, deploy key somente leitura ou GitHub CLI autenticado, sem guardar tokens no repositório:

```bash
git clone git@github.com:trinityrrocha/DevFlow.git
cd DevFlow
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

Sem argumento, `install.sh` executa apenas `--check`. `--dry-run` nunca altera o servidor. A instalação só começa com `--install`, privilégios elevados e confirmação literal.

O instalador cria um checkout operacional root-only em `/opt/devflow/source`. Para atualizações futuras do repositório privado, configure na VPS uma credencial somente leitura, preferencialmente uma deploy key exclusiva deste repositório; nunca coloque token no código, `.env` ou URL remota.

O guia completo está em [instalação na VPS](docs/infrastructure/vps-installation.md).

## Modos de infraestrutura

- `DEVFLOW_PROXY_MODE=isolated`: o container `edge` do DevFlow é o único dono das portas 80/443.
- `DEVFLOW_PROXY_MODE=shared`: o Nginx do host recebe somente `/etc/nginx/conf.d/devflow.conf`; frontend e API ficam vinculados a `127.0.0.1`.

A escolha é sempre explícita. Se `fullpassword_nginx` for detectado, o instalador para sem modificá-lo: a baseline não consegue provar um ponto de extensão persistente dentro desse container. A coexistência requer preparação manual reversível, descrita no guia de VPS.

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
- [Instalação na VPS](docs/infrastructure/vps-installation.md)
- [Primeiro deployment](docs/operations/first-deployment.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Segurança](docs/security/security-baseline.md)
- [Padrões de desenvolvimento](docs/development/standards.md)
- [Roadmap](docs/roadmap.md)
- [Rastreabilidade](docs/traceability.md)
- [Changelog](CHANGELOG.md)

## Licenciamento

Nenhuma licença de software foi definida nesta fase. A ausência de um arquivo `LICENSE` não concede permissão de uso, cópia, modificação ou redistribuição. A decisão de licenciamento permanece com o proprietário.
