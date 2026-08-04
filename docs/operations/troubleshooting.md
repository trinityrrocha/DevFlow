# Troubleshooting operacional

## Provider e proxy central

- `reason=controlled-proxy-migration-required`: não repita com o provider legado; execute somente `sudo ./scripts/migrate-proxy-to-host-nginx.sh --check` e depois `--dry-run`.
- `invalid-host-nginx`: execute `sudo nginx -t` e corrija a configuração que ele indicar; o DevFlow não sobrescreve arquivos sem seu marcador.
- porta loopback 18080/13000 ocupada: identifique o proprietário com `sudo ss -lntp`; não encerre processos automaticamente.
- `infrastructure-provider.json` divergente: não edite o JSON manualmente; compare com `/opt/devflow/config/devflow.env` e restaure o estado validado da instalação.
- reload revertido: consulte `/opt/devflow/backups/proxy` e o log sanitizado; a configuração anterior já terá sido restaurada quando possível.

O health diferencia Nginx ativo, sintaxe, certificado/Certbot, upstreams locais e endpoints públicos. O Nginx global nunca é removido pelo uninstall.

## Diagnóstico seguro

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
```

O relatório omite valores de ambiente, credenciais, anexos e dados pessoais. Revise-o antes de compartilhar mesmo assim.

## Revision OCI diverge do checkout instalado

Se a versão das imagens estiver correta, mas `backend_image_commit_match=false` ou
`frontend_image_commit_match=false`, não edite `installation.json` e não execute update.
Use o checkout operacional mais novo somente como executor:

```bash
cd ~/DevFlow
sudo ./scripts/reconcile-installed-release.sh --check
sudo ./scripts/reconcile-installed-release.sh --reconcile
```

Confirme `reconciliation_available=true` antes de escolher `1`. O script não usa `down`,
não recria banco, não executa migrations e não toca no proxy. Se ocorrer rollback, preserve
`/opt/devflow/state/reconciliation.json`, o log sanitizado e as tags
`devflow-reconcile-backup-*`; não execute prune.

Para uma resposta operacional objetiva e a identidade das releases:

```bash
sudo /opt/devflow/app/scripts/health.sh
sudo /opt/devflow/app/scripts/version.sh --all --refresh
```

## Docker ou Compose indisponível

```bash
sudo systemctl status docker
docker version
docker compose version
```

O instalador exige Docker 24+ e Compose v2 2.20+. Não reinstale Docker manualmente sobre uma instalação existente sem entender a origem dos pacotes.

## Bootstrap público não baixa o projeto

Confirme DNS e HTTPS sem adicionar credenciais:

```bash
getent ahosts github.com
getent ahosts raw.githubusercontent.com
wget --spider https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/VERSION
git ls-remote https://github.com/trinityrrocha/DevFlow.git refs/heads/main
```

O bootstrap falha se o arquivo baixado não corresponder mais à `main`, se a consistência de versões divergir ou se o commit clonado não for o commit remoto. `main` não possui pin implícito; quando `--expected-version` for informado, a mensagem apresenta referência, versão esperada, detectada e commit. Baixe novamente o bootstrap em vez de desabilitar a validação.

## Porta ocupada

Se 80/443 pertencerem de forma comprovada a `fullpassword_nginx`, isso não é falha da instalação interna. Confirme `public_proxy_status=occupied-by-known-docker-proxy`, `owner_proven=true` nas duas portas e execute o dry-run com `--install-scope internal`.

Se `127.0.0.1:18080` ou `127.0.0.1:13000` estiver ocupada por outro serviço, a instalação interna permanece bloqueada. Não encerre o processo desconhecido automaticamente; escolha outras portas explicitamente ou libere-as em janela controlada.

`owner-unproven` bloqueia somente publicação. Colete `docker ps`, `docker inspect`, `docker port` e `ss -lntp` com privilégio suficiente antes de qualquer decisão.

```bash
sudo ss -ltnp
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Não pare o proprietário da porta. Escolha `shared` com portas loopback livres ou reprograme a instalação.

## `fullpassword_nginx` detectado

Esse resultado inicia um gate estrito, não autoriza integração por si só. Consulte:

```bash
sudo less /opt/devflow/logs/shared-proxy-diagnostic.log
```

O relatório contém somente inventário sanitizado. Se retornar `blocked`, nenhuma mutação deve ocorrer. Se retornar `compatible-with-compose-override`, confirme que os caminhos e mounts são exatamente os aprovados antes de autorizar o instalador. Consulte o [adaptador persistente](../infrastructure/fullpassword-nginx-adapter.md).

O commit `4d350685cbc9d21b49fb4c01176b846ca66d6584` foi ensaiado em VPS e parou corretamente nesse ponto. Não classifique o evento como instalação compartilhada aprovada.

### Compose bloqueado por `/opt/fullpassword/.env`

Se o dry-run comum informar `reason=privileged-compose-validation-required`, `compose_validation_attempted=false` e `changes_performed=false`, a estrutura ainda não foi classificada como incompatível. Repita o comando completo exibido, adicionando apenas o `sudo` já orientado pelo instalador. Não execute `chmod`, `chown`, `cat`, `source`, `cp`, `grep` ou outro comando para abrir ou copiar o `.env` do Full Password.

No dry-run privilegiado, confirme no relatório:

```text
operation_mode=dry-run
execution_is_root=true
compose_validation_attempted=true
changes_performed=false
sensitive_values_logged=false
```

Somente `compose_cross_directory_supported=true`, `compose_merge_valid=true` e `installation_ready=true` permitem avançar para uma instalação separada. Um erro de permissão como root, variável obrigatória ausente ou conteúdo inválido mantém o gate fechado com motivo sanitizado; não exponha o arquivo para contornar o erro.

Depois de instalar o adaptador, diagnostique sempre com os dois Compose:

```bash
sudo docker compose \
  --project-directory /opt/fullpassword \
  -f /opt/fullpassword/docker-compose.yml \
  -f /opt/devflow/config/proxy/fullpassword-nginx.override.yml \
  config
sudo docker exec fullpassword_nginx nginx -t
sudo /opt/devflow/app/scripts/health.sh
```

Não execute `docker compose up` apenas com o arquivo original enquanto o override estiver ativo: uma recriação isolada pode desconectar `devflow_edge` e remover o mount de `devflow.conf`.

## Caddy detectado

O suporte automático ainda não existe. A mensagem esperada é:

```text
Proxy Caddy detectado, mas a integração automática ainda não está disponível.
A instalação foi interrompida sem alterações no proxy.
```

Não converta Caddyfile, certificados ou redes por tentativa. Use o relatório e aguarde um adaptador implementado e testado.

## Falha no Nginx

```bash
sudo nginx -t
sudo systemctl status nginx
sudo head -n 3 /etc/nginx/conf.d/devflow.conf
```

O arquivo deve começar com o marcador DevFlow. Promoção e remoção usam arquivo temporário no mesmo diretório, `nginx -t`, backup persistente em `/opt/devflow/backups/proxy` e rollback automático inclusive quando `systemctl reload nginx` falha.

Não edite configurações de outra aplicação para contornar o diagnóstico.

## Certificado não emitido

Confirme DNS, porta 80 e virtual host:

```bash
getent ahosts devflow.exemplo.com
sudo ss -ltnp | grep -E ':(80|443)\b'
sudo certbot certificates
```

Não reutilize certificado de outro domínio nem copie chave privada para o repositório.

No adaptador Full Password, a instalação publica antes um desafio aleatório em `/opt/devflow/storage/acme` (montado como `/var/www/certbot` no Nginx) e exige que ele seja recuperado por `http://dev.sti1.com.br`. Falha nessa prova interrompe a emissão e restaura o proxy anterior. Não emita manualmente até corrigir DNS, NAT ou porta 80.

## Banco não fica saudável

```bash
cd /opt/devflow/app
sudo docker compose --env-file /opt/devflow/config/devflow.env -p devflow ps
sudo docker compose --env-file /opt/devflow/config/devflow.env -p devflow logs --tail 50 db
```

Não execute migration manual com schema inconsistente. Preserve o banco e investigue permissões de `/opt/devflow/data/postgres`, capacidade e healthcheck.

## Build concluída, mas a imagem não foi identificada

Na `0.4.3-alpha`, o instalador executava `docker compose ... images -q backend`. Esse comando retornou vazio porque nenhum container do backend havia sido criado, embora a build tivesse produzido `devflow-backend:latest` (também exibida canonicamente como `docker.io/library/devflow-backend:latest`). A `0.4.4-alpha` usa o JSON resolvido do Compose e `docker image inspect`.

Não apague imagens nem execute prune. Atualize o checkout local da VPS e faça primeiro o dry-run:

```bash
cd ~/DevFlow
git pull --ff-only origin main
sudo ./install.sh --dry-run --install-scope internal \
  --super-admin-email contato@sti1.com.br
sudo ./install.sh --resume \
  --super-admin-email contato@sti1.com.br
```

Consulte `/opt/devflow/state/install-transaction.json` e o log sanitizado em `/opt/devflow/logs`. A retomada só avança com checkout canônico e limpo, configuração privada regular com modo 600/400 e versão compatível por fast-forward. Imagens legadas sem rótulos OCI são reconstruídas para estabelecer proveniência; imagens já rotuladas com o mesmo commit e versão são reutilizadas.

## Instalador encerrou antes do log definitivo

Na `0.4.4-alpha`, uma tentativa legada sem `install-transaction.json` fazia uma função booleana retornar `1` sob `set -e` antes do trap operacional. A `0.4.5-alpha` inicializa um logger 0600 em `/tmp` e instala o trap antes dos imports.

Use somente o diagnóstico sanitizado:

```bash
sudo ./install.sh --diagnose-startup
```

Depois execute o dry-run e confira `transaction_state_present=false`, `transaction_state_reconstruction_planned=true`, `can_resume=true`, `resume_from_stage=05-build-images` e `changes_applied=false`. Não abra o `.env`, não use tracing do shell e não apague o diretório parcial.

## Compose informa `DB_PASSWORD` ausente durante o dry-run

Na `0.4.5-alpha`, a validação de imagens montava um comando Compose separado e não aplicava de forma consistente `/opt/devflow/config/devflow.env`. O campo `env_file` de um serviço injeta variáveis no container, mas não substitui `docker compose --env-file` na interpolação do YAML. A mensagem posterior sobre imagem era somente um efeito secundário.

A partir da `0.4.6-alpha`, o resumo sanitizado diferencia:

```text
compose_structure_valid=true
compose_runtime_config_valid=true|false|not-applicable-before-configuration
compose_env_file_applied=true|false
missing_required_env_keys=none|CHAVE1,CHAVE2
resume_from_stage=04-configuration|...
```

O dry-run nunca mostra valores. Se a configuração estiver incompleta sem banco, volume ou migration, a recuperação fica disponível apenas no `--resume`, preserva o arquivo anterior em `/opt/devflow/backups/install/` e exige `REGERAR CONFIGURAÇÃO DEVFLOW`. Se existir qualquer dado persistente, não regenere a senha: siga a recuperação manual indicada pelo instalador.

## Migration falhou

Na instalação inicial, a release não é promovida. Durante update, a falha aciona automaticamente o backup pré-update e os containers anteriores. Não marque a migration, não altere `schema_migrations` e não repita o comando manualmente.

## Update não encontra o GitHub

O checkout `/opt/devflow/source` é protegido, público e não abre prompt de autenticação. Confirme:

```bash
sudo git -C /opt/devflow/source status --short
sudo git -C /opt/devflow/source remote -v
sudo GIT_TERMINAL_PROMPT=0 git -C /opt/devflow/source ls-remote origin refs/heads/main
```

O remote deve ser exatamente `https://github.com/trinityrrocha/DevFlow.git`. Não adicione token, deploy key, chave SSH ou credencial à VPS e não altere o remote para contornar a validação.

## Update falhou e executou rollback

Consulte primeiro os resultados sanitizados:

```bash
sudo cat /opt/devflow/state/update-report.txt
sudo ls -lt /opt/devflow/logs/update-*.log
sudo /opt/devflow/app/scripts/health.sh
```

`rollback=success` significa que dados, release, containers e proxy anteriores passaram pelos checks. Preserve o backup e o log para investigar a fase registrada. `rollback=failed` exige congelar novas operações, preservar a VPS e revisar cada falha antes de qualquer restore manual.

Se uma página `503` permanecer, não derrube containers por tentativa. Verifique o modo do proxy, `devflow-maintenance`, o virtual host gerenciado e o relatório. O updater tenta retirar a manutenção mesmo quando o rollback encontra outra falha.

## Backend ou frontend `running`, mas não `healthy`

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
curl --fail --verbose https://devflow.exemplo.com/api/health
```

`running` não encerra o gate. Verifique migration, versão esperada, DNS, proxy e healthcheck antes de considerar uma nova tentativa.

## Recuperação

Preserve `/opt/devflow/config`, `/opt/devflow/data`, `/opt/devflow/storage` e `/opt/devflow/backups`. Consulte [atualização, backup e rollback](../infrastructure/update-backup-rollback.md) antes de restaurar. Não use `docker system prune`, não apague volumes por tentativa e não remova recursos do Full Password.

### Instalação inicial interrompida antes da promoção

Se não existe `/opt/devflow/app`, mas uma tentativa anterior preservou `/opt/devflow/source`, execute novamente `--check` e `--dry-run` a partir do clone atualizado. O modo `--install` aceita somente checkout limpo, remote oficial, branch `main` e avanço fast-forward até a release verificada. Ele preserva configuração, banco, storage, backups e releases anteriores. Divergência, alteração local ou histórico não linear interrompe a retomada; não remova `/opt/devflow` por tentativa.
