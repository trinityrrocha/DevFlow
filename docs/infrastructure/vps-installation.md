# Instalação em VPS Linux para homologação

> Versão `0.4.11-alpha`: reconcilie a release e migre o estado para o schema v2 antes da publicação externa; a homologação real exige executar todos os gates abaixo na VPS.

```bash
./install.sh --check
sudo ./install.sh --dry-run --install-scope internal \
  --super-admin-email admin@example.com
sudo ./install.sh --install-internal \
  --super-admin-email admin@example.com
```

> O DevFlow 0.4.11-alpha não está aprovado para produção. Este procedimento é exclusivo para homologação.

Quando o Full Password ocupa 80/443, instale e homologue o DevFlow somente em loopback. Para o estágio externo, limite-se a `scripts/publish.sh --dry-run` ou aos diagnósticos `scripts/migrate-proxy-to-host-nginx.sh --check` e `--dry-run`; não execute `--migrate` automaticamente.

## 1. Pré-requisitos

- Ubuntu 22.04/24.04 ou Debian 12/13, `amd64` ou `arm64`;
- 2 GiB de RAM e 5 GiB livres, no mínimo;
- usuário com `sudo`;
- domínio exclusivo resolvendo para a VPS somente antes da publicação externa;
- conectividade HTTPS com `github.com` e `raw.githubusercontent.com`;
- snapshot da VPS recomendado antes do primeiro ensaio.
- para diagnósticos legados do `fullpassword_nginx`, `python3` e `openssl` disponíveis antes das validações read-only de merge e certificado;

O instalador suporta Docker Engine 24+ e Compose v2 2.20+. Ele não altera firewall, não executa `docker system prune`, não reinicia containers de terceiros e não remove Docker globalmente.

## 2. Bootstrap público

Não use `curl | bash` ou `wget | bash`. Baixe o bootstrap, revise o arquivo e execute separadamente:

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
less install.sh
```

O bootstrap é independente de checkout anterior. Git deve estar instalado previamente: ele é usado para bloquear redirecionamentos, validar origem, referência e commit antes da confirmação. O bootstrap não instala dependências. O checkout temporário usa HTTPS público e é removido ao sair.

Não são necessários token, GitHub CLI, deploy key ou chave SSH. A VPS nunca deve receber commits.

## 3. Diagnóstico e plano

```bash
./install.sh --check
```

Esse modo cria somente um checkout temporário, comprova remote, branch, commit e `VERSION`, chama o diagnóstico interno e remove os temporários. Não requer `root` nem altera a instalação.

No modo compartilhado, `--check` faz apenas o inventário básico. Ele identifica os caminhos dos inputs declarados pelo Compose (`.env`, `env_file` e variáveis obrigatórias), sem abrir seu conteúdo. Um input protegido é informado como requisito para o dry-run privilegiado, não como incompatibilidade.

Escolha explicitamente o proxy e valide o plano:

```bash
./install.sh --dry-run \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Para coexistência com um proxy que ocupa 80/443, não informe domínio ou Let's Encrypt no estágio interno:

```bash
sudo ./install.sh --dry-run \
  --install-scope internal \
  --super-admin-email contato@sti1.com.br

sudo ./install.sh --install-internal \
  --super-admin-email contato@sti1.com.br
```

Se `/opt/devflow` contiver a tentativa parcial da versão anterior, atualize primeiro o checkout de operação e valide a retomada:

```bash
cd ~/DevFlow
git pull --ff-only origin main
git rev-parse HEAD
cat VERSION

sudo ./install.sh --dry-run \
  --install-scope internal \
  --super-admin-email contato@sti1.com.br

sudo ./install.sh --resume \
  --super-admin-email contato@sti1.com.br
```

Para a tentativa interrompida em `06-validate-images` pelo falso negativo corrigido na
`0.4.8-alpha`, o dry-run esperado inclui:

```text
installation_mode=shared
internal_installation_ready=true
external_publication_ready=false
backend_build_required=true
frontend_build_required=true
resume_from_stage=06-validate-images
can_resume=true
```

Os indicadores de build podem ser `false` quando as imagens locais já possuem todos os
rótulos OCI da versão e do commit atuais. Imagens `0.4.7-alpha` válidas podem ser
reconstruídas para receber os metadados de `0.4.8-alpha`; isso não apaga o volume do
PostgreSQL nem inicia os containers antes das etapas correspondentes.

O `--resume` exibe o menu numérico abaixo e não aceita frases livres:

```text
Instalação incompleta encontrada.

1 - RETOMAR INSTALAÇÃO DO DEVFLOW
2 - CANCELAR

Escolha [1/2]:
```

Após a escolha `1`, a imagem do backend comprova
`/database/migrations/001_initial_schema.sql` por meio de um container efêmero com
`--network none`. A validação não depende de redes do Compose, banco, proxy ou provider.
Em caso de sucesso, o estado registra `completed_stage=06-validate-images` e
`resume_from_stage=07-create-networks`; o volume do PostgreSQL permanece preservado. Não
execute `publish.sh` nem a migração de proxy neste ensaio.

Antes do dry-run, o diagnóstico sanitizado pode confirmar imports, argumentos e dependências sem abrir o `.env`:

```bash
sudo ./install.sh --diagnose-startup
```

Não use tracing de Bash: ele pode imprimir variáveis sensíveis. Todo código diferente de zero deve vir acompanhado por mensagem funcional e pelo caminho do log inicial protegido.

O dry-run deve exibir o checkout parcial, versão, commit, etapa registrada, imagens esperadas/resolvidas e os flags `*_build_required`. Imagens `0.4.3-alpha` sem rótulos de proveniência podem existir, mas a primeira retomada em `0.4.4-alpha` as reconstrói para vincular versão e commit. Não execute `publish.sh` nessa homologação.

O dry-run deve informar `internal_installation_ready=true`, as duas portas loopback disponíveis e `postgres_public_port_exposed=false`. A ocupação comprovada por `fullpassword_nginx` resulta em `external_publication_ready=false`, sem falha global do estágio interno.

Durante esse escopo não são permitidos Nginx no host, Certbot, `/etc/nginx`, certificados, override, reload, migração ou alteração em `/opt/fullpassword`.

## 4. Homologação interna por túnel

```bash
ssh \
  -L 18080:127.0.0.1:18080 \
  -L 13000:127.0.0.1:13000 \
  ubuntu@IP_DA_VPS
```

No computador local, acesse `http://127.0.0.1:18080`. As portas nunca devem ser alteradas para `0.0.0.0`.

Confirme o estado sem exigir HTTPS:

```bash
sudo /opt/devflow/app/scripts/health.sh
```

O resultado interno saudável apresenta `backend_image_present=true`, `frontend_image_present=true`, `postgres_image_present=true`, `database_healthy=true`, `migrations_current=true`, `internal_backend_healthy=true`, `internal_frontend_healthy=true`, `external_publication_enabled=false`, `external_https_status=not-configured` e `overall_internal_health=healthy`.

## 5. Reconciliar imagens e estado legado antes da publicação

A release imutável `0.4.8-alpha` em `/opt/devflow/app` não contém a ferramenta operacional
mais nova. Execute-a diretamente no checkout atualizado em `~/DevFlow`; o contexto de build
continua sendo exclusivamente `/opt/devflow/source`, portanto a aplicação não é atualizada:

```bash
cd ~/DevFlow
sudo ./scripts/reconcile-installed-release.sh --check
sudo ./scripts/reconcile-installed-release.sh --reconcile
```

Escolha `1` somente depois de confirmar identidade canônica, banco saudável, migration atual e
`reconciliation_available=true`. A operação cria imagens candidatas, valida labels/conteúdo,
mantém tags das imagens anteriores e recria somente backend/frontend. O estado anterior é
preservado em `/opt/devflow/backups/state` e promovido por rename atômico apenas após health.

Valide com o health da mesma revisão operacional:

```bash
sudo ./scripts/health.sh --internal
sudo cat /opt/devflow/state/installation.json
```

Para uma API `0.4.8-alpha` sem campo `commit`, o resultado esperado é
`api_commit_match=unsupported-by-installed-release`; versão da API e labels OCI continuam
obrigatórias. Não copie scripts para dentro da release imutável e não execute update,
publicação externa ou migração de proxy nesta etapa.

## 6. Publicação externa posterior

```bash
sudo /opt/devflow/app/scripts/publish.sh --dry-run \
  --provider host-nginx \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br
```

O publicador exige aplicação interna saudável, DNS, propriedade comprovada de 80/443 e provider pronto. Ele não reinstala a aplicação nem executa migrations. Enquanto `fullpassword_nginx` ocupar as portas, essa operação permanecerá bloqueada.

O dry-run deve comprovar DNS, 80/443, provider, vhost, Certbot, plano de renovação,
WebSocket, headers, CSP, HSTS, rate limit, HTTP e possibilidade de rollback. HTTPS permanece
`not-configured` até a emissão ou reutilização do certificado. Depois da migração controlada
e de todos os gates, publique explicitamente e valide o health:

```bash
sudo /opt/devflow/app/scripts/publish.sh --publish \
  --provider host-nginx \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br
sudo /opt/devflow/app/scripts/health.sh
```

O health final deve informar `external_publication_enabled=true`,
`external_https_status=healthy`, `certificate_status=valid`, `renewal_status=healthy` e
`overall_health=healthy`. Ensaie o rollback em janela controlada com
`sudo /opt/devflow/app/scripts/publish.sh --rollback` e repita o dry-run antes de republicar.

Use instalação completa somente quando o provider puder publicar com segurança. Um `fullpassword_nginx` comprovado não é selecionado como adaptador: ele bloqueia o estágio externo e mantém o estágio interno disponível. Caddy, proprietários desconhecidos e evidências divergentes permanecem fail-closed para publicação.

Se o dry-run comum encerrar com código `3` e `reason=privileged-compose-validation-required`, repita exatamente o mesmo plano com `sudo`:

```bash
sudo ./install.sh --dry-run \
  --proxy-mode shared \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br \
  --super-admin-email ADMIN_AUTORIZADO
```

Essa execução privilegiada continua sem mutações: não instala pacotes, não cria recursos Docker, não reinicia containers e não altera permissões. Para a arquitetura atual, prefira o dry-run com `--install-scope internal`; diagnósticos privilegiados do Compose do Full Password são apenas evidência histórica da migração, não requisito da instalação interna.

Também é possível executar `sudo ./install.sh` sem argumentos. Nesse caso, o bootstrap pergunta domínio, e-mails, modo de proxy e confirmação antes de qualquer mudança permanente.

## 6. Cenário A — VPS limpa

Confirme que 80/443 estão livres e execute:

```bash
sudo ./install.sh --install \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Após a confirmação numérica, o instalador:

1. instala Docker/Compose pelo repositório oficial apenas se ausentes;
2. instala Certbot se necessário;
3. cria `/opt/devflow` com permissões restritivas;
4. arquiva o commit Git em `/opt/devflow/releases/<sha>`;
5. cria `/opt/devflow/source`, checkout operacional root-only com hooks desabilitados;
6. gera a configuração privada e segredos com OpenSSL;
7. inicia PostgreSQL e espera `healthy`;
8. executa `001_initial_schema.sql` pelo migrador com advisory lock;
9. consulta `schema_migrations` no PostgreSQL;
10. emite o certificado do domínio;
11. inicia backend, frontend e edge e espera os healthchecks;
12. valida frontend e `/api/health` por HTTPS;
13. habilita o timer de backup e grava relatório sanitizado.

O relatório registra data, versão, commit, branch, URL pública do repositório e canal de atualização.

O instalador não aceita checkout sujo nem origem sem commit Git. Isso impede uma release local não reproduzível.

## 7. Cenário B — Docker e Nginx existentes

Use portas loopback exclusivas e o proxy compartilhado:

```bash
./install.sh --dry-run \
  --proxy-mode shared \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com \
  --http-port 18080 \
  --api-port 13000

sudo ./install.sh --install \
  --proxy-mode shared \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com \
  --http-port 18080 \
  --api-port 13000
```

Antes do plano, o instalador pede autorização específica para executar um diagnóstico somente leitura. O relatório sanitizado é salvo em `/opt/devflow/logs/shared-proxy-diagnostic.log` e registra tipo, container, imagem, status, health, portas, redes, mounts, includes, certificados, reload, compatibilidade e bloqueios. Nenhuma chave, senha, token ou conteúdo do ambiente é coletado.

Um Nginx do host é aceito apenas quando `nginx -t`, include persistente de `/etc/nginx/conf.d/*.conf`, mecanismo de certificado, reload, domínio e portas forem comprovados. O instalador cria exclusivamente `/etc/nginx/conf.d/devflow.conf`. Durante ACME, apenas o challenge é servido e todo o restante responde `503`; o proxy da aplicação só é publicado depois dos health checks internos. A aplicação é atômica, guarda backup em `/opt/devflow/backups/proxy`, valida antes e depois, e restaura o arquivo anterior inclusive quando o reload falha.

Se o Nginx existente não inclui `/etc/nginx/conf.d/*.conf`, prepare um include persistente e documentado antes de executar o instalador. Não modifique arquivos de outra aplicação.

## 8. Coexistência com Full Password

Se existir `fullpassword_nginx`, o instalador cruza `ss`, `docker ps`, `docker inspect` e `docker port`. Evidência coerente deve identificar o mesmo container em 80 e 443; divergência permanece fail-closed. A propriedade comprovada autoriza apenas o estágio interno e registra `proxyMigrationRequired=true`.

Instale sem integrar redes, Compose, Nginx ou certificados do Full Password:

```bash
sudo ./install.sh --dry-run --install-scope internal \
  --super-admin-email ADMIN_AUTORIZADO
sudo ./install.sh --install-internal \
  --super-admin-email ADMIN_AUTORIZADO
```

Depois da homologação interna, o publicador continuará bloqueado enquanto o proxy ocupar 80/443. Para coletar evidências da futura migração sem alterar o servidor:

```bash
sudo ./scripts/publish.sh --dry-run \
  --provider host-nginx \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br
sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
```

O [adaptador persistente legado](fullpassword-nginx-adapter.md) permanece documentado para rastreabilidade e rollback, mas não é selecionado automaticamente nem faz parte da instalação interna. Não edite `/opt/fullpassword`, não conecte redes e não recrie `fullpassword_nginx` por comandos manuais.

## 9. Diretórios e persistência

```text
/opt/devflow/
├── app -> releases/<sha>
├── config/
│   ├── devflow.env          # 0600
│   ├── backup.passphrase    # 0600
│   └── bootstrap-token      # 0600
├── data/postgres/           # persistente
├── backups/                 # persistente
├── logs/                    # sanitizado
├── source/                  # checkout operacional root-only
├── storage/uploads/         # persistente
└── releases/                # releases imutáveis
```

Não use `chmod 777`. Os containers executam com os usuários definidos nas imagens; não é criado usuário Linux adicional nesta baseline.

## 10. Primeiro acesso

Leia o token sem copiá-lo para logs:

```bash
sudo -i
cd /opt/devflow/config
# abra bootstrap-token diretamente em um terminal protegido
```

Use o e-mail informado na instalação, defina uma senha forte e configure MFA. O backend restringe as demais rotas enquanto a troca de senha ou o cadastro de MFA estiver pendente. Depois de confirmar o bootstrap, remova o token:

```bash
sudo rm -- /opt/devflow/config/bootstrap-token
```

## 11. SMTP e domínio

Edite somente o arquivo privado:

```bash
sudoedit /opt/devflow/config/devflow.env
sudo chmod 600 /opt/devflow/config/devflow.env
```

Defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`. Nunca mostre o arquivo completo em ticket ou diagnóstico. O domínio não pode ser compartilhado com outro virtual host.

## 12. Verificação

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
curl --fail --silent https://devflow.exemplo.com/api/health
curl --fail --silent https://devflow.exemplo.com/
```

O relatório da instalação fica em `/opt/devflow/state/installation.json`; a versão instalada fica em `/opt/devflow/state/version.json`. A conclusão exige `healthy`, não apenas `running`.

## 13. Atualização, remoção e recuperação

O checkout `/opt/devflow/source` usa exclusivamente `https://github.com/trinityrrocha/DevFlow.git`. Como o repositório é público, consultas e atualizações não dependem de credenciais. Não configure token, chave SSH, deploy key ou credential helper para o DevFlow na VPS.

```bash
sudo /opt/devflow/app/scripts/version.sh --all --refresh
sudo /opt/devflow/app/scripts/update.sh --check
sudo /opt/devflow/app/scripts/update.sh
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data --remove-devflow-certificate
sudo /opt/devflow/app/scripts/uninstall.sh --purge
```

O updater aceita apenas remote `trinityrrocha/DevFlow`, branch `main`, checkout limpo e fast-forward. Ele exibe a versão e o changelog antes da confirmação, cria e verifica backup, mantém HTTP 503 durante a troca e restaura automaticamente a versão anterior em falha. Consulte o [runbook operacional](update-backup-rollback.md).

`--keep-data` preserva configuração, banco, storage, backups, releases e o checkout operacional. `--purge` exige backup existente, lista o alvo e pede duas confirmações literais. O certificado DevFlow só é removido com `--remove-devflow-certificate` e uma confirmação adicional. Docker e todos os certificados/arquivos do Full Password são sempre preservados.

## 14. Limitações da alpha

- sem interface web administrativa para o updater;
- rollback automático implementado, mas ainda sem fault-injection e restore drill na VPS;
- adaptador `fullpassword_nginx` implementado, mas ainda sem ensaio real publicado de Docker, Nginx, certificado e rollback;
- integração automática com Caddy e outros Nginx containerizados ainda indisponível;
- sem prova de renovação automática do certificado;
- sem matriz completa de distribuição/arquitetura em CI;
- sem teste E2E, restore drill, pentest ou aprovação para produção.
