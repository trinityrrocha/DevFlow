# DevFlow

Plataforma multi-tenant de governança do desenvolvimento. Cada tarefa é tratada como um dossiê técnico: solicitação, execução, testes, aprovações, artefatos GitHub, histórico, auditoria e métricas permanecem relacionados e rastreáveis.

> **O DevFlow encontra-se em fase de homologação e ainda não foi aprovado para uso em produção.**

Versão atual: **0.4.13-alpha**. Os Documentos 001, 002 e 003 formam a baseline. A instalação interna e a publicação externa são estágios independentes; a homologação final exige executar os gates em uma VPS Linux. O sistema não está aprovado para produção.

## Estado atual

A baseline inclui backend Node.js/Express, frontend React/Vite, PostgreSQL, migration inicial, autenticação com sessão protegida, MFA TOTP, RBAC multi-tenant, domínio de tarefas, auditoria, Docker Compose, backup criptografado e atualização transacional para homologação.

A imagem backend normaliza migrations para `root:root 0755/0644` durante o build e repete a
validação como usuário não root `devflow`. Symlinks, entradas não regulares, diretórios vazios,
arquivos graváveis/executáveis ou conteúdo divergente bloqueiam instalação, update e reconciliação.

Ainda dependem de homologação em Linux: instalação completa, emissão e renovação real de certificados, integração com PostgreSQL e containers, ensaios de backup/restauração e rollback induzido, E2E, acessibilidade, carga e pentest. Consulte o [estado de implementação](docs/implementation-status.md).

Nenhum código do Full Password foi reutilizado. A referência técnica permaneceu limpa no commit `804008b5df5d0931ec5d95227fed44086f430d76`; os padrões observados estão na [análise arquitetural](docs/architecture/fullpassword-analysis.md).

## Requisitos

- VPS Linux `amd64` ou `arm64` com Ubuntu 22.04/24.04 ou Debian 12/13;
- domínio exclusivo apontado para a VPS;
- pelo menos 2 GiB de RAM e 5 GiB livres;
- acesso `root` por `sudo`;
- Git instalado para validar origem, referência e commit antes de qualquer instalação;
- portas 80/443 disponíveis ao Nginx do host; se `fullpassword_nginx` as ocupar, a migração separada deve ser diagnosticada antes;
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

O bootstrap sem argumentos valida Linux e conectividade, coleta domínio, e-mails e proxy, cria um diretório temporário seguro, clona e valida a `main`, detecta dinamicamente o SemVer consistente do checkout, confere o commit remoto e delega a confirmação numérica ao `scripts/install.sh` validado. Não existe versão alpha fixa no bootstrap.

Pins são sempre explícitos:

```bash
./install.sh --check --ref main --expected-version 0.4.13-alpha
```

Uma referência `vSEMVER` só deve ser usada depois que uma tag correspondente tiver sido criada explicitamente; nenhuma tag é criada nesta entrega.

O fluxo explícito em três etapas também está disponível:

```bash
./install.sh --check
./install.sh --dry-run \
  --provider host-nginx \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
sudo ./install.sh --install \
  --provider host-nginx \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Quando 80/443 estiverem ocupadas, valide e instale somente a aplicação:

```bash
sudo ./install.sh --dry-run \
  --install-scope internal \
  --super-admin-email admin@exemplo.com

sudo ./install.sh --install-internal \
  --super-admin-email admin@exemplo.com
```

Se uma instalação interna tiver sido interrompida, valide primeiro o plano e retome explicitamente:

```bash
sudo ./install.sh --dry-run \
  --install-scope internal \
  --super-admin-email admin@exemplo.com

sudo ./install.sh --resume \
  --super-admin-email admin@exemplo.com
```

A retomada aceita somente checkout canônico, limpo e compatível por fast-forward. Imagens são resolvidas pelo Compose e verificadas com `docker image inspect`; uma imagem só é reutilizada sem build quando seus rótulos de versão e commit correspondem à release.

O Compose runtime recebe sempre `--env-file /opt/devflow/config/devflow.env`. O dry-run informa apenas presença, permissões e nomes de chaves obrigatórias. Se uma configuração parcial estiver incompleta e não existir banco, volume ou migration, `--resume` pode preservá-la e regenerá-la após a escolha `1` no menu numérico. Com qualquer evidência de dados, a recuperação automática é bloqueada.

O backend usa permanentemente `MIGRATIONS_DIR=/database/migrations`. O comando operacional único é:

```bash
docker compose --env-file /opt/devflow/config/devflow.env \
  run --rm --no-deps backend node scripts/migrate.js
```

Use-o somente por meio dos scripts operacionais, que validam a imagem e registram o código de saída.

Antes das redes existirem, a etapa `06-validate-images` inspeciona a imagem resolvida diretamente com `docker run --rm --network none`. Ela não utiliza Compose, banco, volumes, proxy ou provider e diferencia conteúdo ausente de erro do runtime Docker.

Instalações alpha anteriores com metadados legados podem ser verificadas e
reparadas sem reiniciar serviços:

```bash
sudo ./scripts/repair-installation-state.sh --check
sudo ./scripts/repair-installation-state.sh --repair
```

O reparador usa `/opt/devflow/source` como fonte de verdade, preserva o JSON anterior em
`/opt/devflow/backups/state` e grava o schema oficial `schemaVersion: 2` atomicamente. O
update e a publicação externa permanecem bloqueados enquanto o estado estiver degradado.

Quando as labels OCI das imagens também divergirem, use a reconciliação transacional:

```bash
sudo ./scripts/reconcile-installed-release.sh --check
sudo ./scripts/reconcile-installed-release.sh --reconcile --retain-failed-candidates
```

Ela executa o código operacional do checkout atual, mas constrói exclusivamente a partir de
`/opt/devflow/source`. Somente backend e frontend são recriados; PostgreSQL, migrations,
proxy e Full Password permanecem fora do escopo. As imagens anteriores recebem tags de
backup e são restauradas automaticamente se qualquer gate posterior falhar. A retenção é
opt-in e só cria tags `diagnostic-*` após o rollback; nenhuma candidata é promovida ou usada
por containers. O modo padrão continua removendo candidatas que falharam.

Para investigar somente a inicialização, sem exibir valores de configuração ou aplicar mudanças:

```bash
sudo ./install.sh --diagnose-startup
```

O instalador cria o log inicial protegido em `/tmp/devflow-install-bootstrap.*.log`. Em uma instalação efetiva, o conteúdo sanitizado é promovido para o log definitivo em `/opt/devflow/logs`. Não habilite tracing de shell em uma VPS com configuração real.

Esse escopo publica somente `127.0.0.1:18080` e `127.0.0.1:13000`. Não exige domínio ou e-mail TLS, não toca 80/443, Nginx, certificados, migração ou Full Password. O PostgreSQL não possui porta no host.

Para acessar pela estação local:

```bash
ssh \
  -L 18080:127.0.0.1:18080 \
  -L 13000:127.0.0.1:13000 \
  ubuntu@IP_DA_VPS
```

Abra `http://127.0.0.1:18080`. Depois da homologação interna, a publicação é uma operação separada:

```bash
sudo /opt/devflow/app/scripts/publish.sh --dry-run \
  --provider host-nginx \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com
```

Depois que todos os gates do dry-run passarem, publique somente com o modo explícito
`--publish`. A última publicação pode ser desfeita com `scripts/publish.sh --rollback`;
ambas as operações exigem confirmação numérica e mantêm log sanitizado.

Parâmetros de configuração podem ser fornecidos ao bootstrap sem clone prévio:

```bash
sudo ./install.sh \
  --provider host-nginx \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

`--check` e `--dry-run` não fazem instalação. No bootstrap baixado, a ausência de modo inicia o fluxo interativo; no launcher existente dentro do repositório, a ausência de modo continua equivalendo a `--check`.

O instalador cria `/opt/devflow/source` como checkout operacional root-only, sem hooks e com remote HTTPS público. Instalação e atualizações não utilizam token, deploy key, chave SSH ou autenticação GitHub.

O guia completo está em [instalação na VPS](docs/infrastructure/vps-installation.md).

## Providers de infraestrutura

O provider padrão é `host-nginx`: um proxy central no Linux atende múltiplos domínios, enquanto cada aplicação mantém containers, redes, volumes, banco e diretórios próprios. Frontend e API DevFlow ficam somente em `127.0.0.1`; PostgreSQL não publica porta. Consulte [providers](docs/infrastructure/providers.md) e [Host Nginx Provider](docs/infrastructure/host-nginx-provider.md).

- `DEVFLOW_INFRASTRUCTURE_PROVIDER=host-nginx`: padrão recomendado; Nginx e certificados no host.
- `DEVFLOW_INFRASTRUCTURE_PROVIDER=isolated-nginx`: somente VPS exclusiva; proxy DevFlow ocupa 80/443.
- `DEVFLOW_INFRASTRUCTURE_PROVIDER=legacy-docker-nginx`: legado, descontinuado e somente explícito para transição/rollback.

Se `fullpassword_nginx` ocupar 80/443, somente a publicação externa fica bloqueada. A instalação interna continua disponível e preserva integralmente o proxy. A futura transição usa o [procedimento separado de migração](docs/infrastructure/proxy-migration.md); não execute migração automaticamente.

```bash
sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
sudo ./scripts/migrate-proxy-to-host-nginx.sh --dry-run
```

O check não persiste arquivos. O dry-run grava somente evidências sanitizadas em `/var/log/devflow/proxy-migration-dry-run.log`; nenhum deles altera containers, portas ou o Nginx. Não execute `--migrate` com base apenas nesta versão.

A rede `devflow_edge` contém somente frontend, backend e edge; `devflow_internal` é interna e contém somente PostgreSQL e backend. O proxy nunca recebe acesso à rede do banco.

O adaptador anterior de `fullpassword_nginx` permanece no código apenas como provider legado, para diagnóstico e rollback durante a transição. Ele nunca é selecionado automaticamente para uma nova instalação. Seu contrato histórico está documentado em [adaptador legado](docs/infrastructure/fullpassword-nginx-adapter.md).

O DevFlow é integralmente instalado em `/opt/devflow`. O diretório `/opt/fullpassword` continua somente leitura; qualquer override futuro que controle o proxy fica no diretório neutro `/etc/devflow/proxy-migrations`, fora dos dois repositórios.

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
