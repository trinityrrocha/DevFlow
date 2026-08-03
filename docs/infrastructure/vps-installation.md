# Instalação em VPS Linux para homologação

> Versão `0.4.1-alpha`: o provider padrão é `host-nginx`. Antes de instalar, use `./install.sh --check` e o dry-run com `--provider host-nginx`. Se `fullpassword_nginx` ocupar 80/443, a instalação será bloqueada; execute somente os diagnósticos descritos em [migração de proxy](proxy-migration.md). Nenhuma instalação ou migração desta versão foi homologada na VPS.

```bash
./install.sh --check
./install.sh --dry-run --provider host-nginx --domain devflow.example.com \
  --letsencrypt-email tls@example.com --super-admin-email admin@example.com
sudo ./install.sh --install --provider host-nginx --domain devflow.example.com \
  --letsencrypt-email tls@example.com --super-admin-email admin@example.com
```

> O DevFlow 0.4.1-alpha não está aprovado para produção. Este procedimento é exclusivo para homologação.

Quando o Full Password ocupa 80/443, a única atividade autorizada nesta etapa é coletar evidências com `sudo ./scripts/migrate-proxy-to-host-nginx.sh --check` e `--dry-run`. O segundo comando grava somente `/var/log/devflow/proxy-migration-dry-run.log`; não execute `--migrate` automaticamente.

## 1. Pré-requisitos

- Ubuntu 22.04/24.04 ou Debian 12/13, `amd64` ou `arm64`;
- 2 GiB de RAM e 5 GiB livres, no mínimo;
- usuário com `sudo`;
- domínio exclusivo resolvendo para a VPS;
- conectividade HTTPS com `github.com` e `raw.githubusercontent.com`;
- snapshot da VPS recomendado antes do primeiro ensaio.
- no modo `fullpassword_nginx`, `python3` e `openssl` já disponíveis para as validações read-only de merge e certificado antes de qualquer instalação de pacotes;

O instalador suporta Docker Engine 24+ e Compose v2 2.20+. Ele não altera firewall, não executa `docker system prune`, não reinicia containers de terceiros e não remove Docker globalmente.

## 2. Bootstrap público

Não use `curl | bash` ou `wget | bash`. Baixe o bootstrap, revise o arquivo e execute separadamente:

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
less install.sh
```

O bootstrap é independente de checkout anterior. Ele valida Linux, conectividade e dependências; somente após a confirmação de instalação pode instalar Git ausente pelos pacotes da distribuição. O checkout temporário usa HTTPS público e é removido ao sair.

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

Troque `isolated` por `shared` somente quando já existir um proxy. O modo compartilhado não é inferido automaticamente e não compartilha containers, volumes, banco ou storage. Esta versão aceita Nginx do host ou o contrato exato do `fullpassword_nginx`; Caddy e outros proxies containerizados são diagnosticados e bloqueados.

Se o dry-run comum encerrar com código `3` e `reason=privileged-compose-validation-required`, repita exatamente o mesmo plano com `sudo`:

```bash
sudo ./install.sh --dry-run \
  --proxy-mode shared \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br \
  --super-admin-email ADMIN_AUTORIZADO
```

Essa execução privilegiada continua sem mutações: não instala pacotes, não cria recursos Docker, não reinicia containers e não altera permissões. Root é usado somente para que `docker compose --project-directory /opt/fullpassword` possa consumir seus próprios inputs protegidos. Somente depois de um dry-run privilegiado aprovado deve ser considerada uma execução separada com `--install`.

Também é possível executar `sudo ./install.sh` sem argumentos. Nesse caso, o bootstrap pergunta domínio, e-mails, modo de proxy e confirmação antes de qualquer mudança permanente.

## 4. Cenário A — VPS limpa

Confirme que 80/443 estão livres e execute:

```bash
sudo ./install.sh --install \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Após a confirmação literal, o instalador:

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

## 5. Cenário B — Docker e Nginx existentes

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

## 6. Coexistência com Full Password

Se existir `fullpassword_nginx`, o instalador oferece o diagnóstico read-only. Ele só prossegue quando o relatório retorna `compatibility=compatible-with-compose-override` e comprova o contrato exato de projeto, serviço, caminhos, mounts, rede, include, domínio e merge. Não use o adaptador com uma topologia apenas parecida.

O `--check` real da versão `0.3.2-alpha`, commit `be1636861505d4f8bedbd42e84d3d66eb70f6fad`, comprovou que o Compose original depende de `/opt/fullpassword/.env` protegido. O dry-run revelou uma variável de caminho não inicializada antes de qualquer mutação. A versão `0.3.3-alpha` corrige esse fluxo; ainda precisa repetir check, dry-run comum e dry-run privilegiado na VPS. Isso não representa instalação aprovada nem homologação do modo compartilhado.

Para repetir somente o inventário privilegiado a partir de um checkout confiável:

```bash
sudo ./scripts/detect-shared-proxy.sh \
  --container fullpassword_nginx \
  --domain devflow.exemplo.com \
  --output /opt/devflow/logs/shared-proxy-diagnostic.log
```

O código de saída `2` significa que a compatibilidade não foi comprovada; o código `3` solicita a repetição privilegiada porque um input protegido impediu a tentativa completa. Em ambos os casos, não desabilite o gate. Saída zero com `compatible-with-compose-override` comprova somente compatibilidade estrutural para iniciar a instalação transacional.

O adaptador implementado usa:

- `/opt/devflow/config/proxy/fullpassword-nginx.override.yml` como override independente;
- `/opt/devflow/config/nginx/devflow.conf` como virtual host exclusivo;
- `devflow_edge` como rede externa gerenciada;
- `devflow-frontend:80` e `devflow-backend:3000` como upstreams;
- `/opt/devflow/storage/acme` como origem persistente da prova de rota e do desafio ACME;
- `/etc/letsencrypt/live/dev.sti1.com.br` para o certificado exclusivo;
- snapshots em `/opt/devflow/backups/proxy` para rollback.

O instalador não edita o Compose original nem `nginx.runtime.conf`, não usa `docker cp` e não modifica arquivos internos do container. Ele recria somente o serviço `nginx` com os dois Compose após validar a candidata. Leia integralmente o [adaptador persistente](fullpassword-nginx-adapter.md) antes do ensaio.

Para o ambiente comprovado, use explicitamente `shared`, `dev.sti1.com.br` e o e-mail ACME autorizado. Revise primeiro o relatório e o dry-run; não force a compatibilidade:

```bash
./install.sh --dry-run \
  --proxy-mode shared \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br \
  --super-admin-email ADMIN_AUTORIZADO

sudo ./install.sh --install \
  --proxy-mode shared \
  --domain dev.sti1.com.br \
  --letsencrypt-email contato@sti1.com.br \
  --super-admin-email ADMIN_AUTORIZADO
```

Não coloque senha ou token na linha de comando. `ADMIN_AUTORIZADO` deve ser substituído pelo e-mail real do primeiro administrador.

## 7. Diretórios e persistência

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

## 8. Primeiro acesso

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

## 9. SMTP e domínio

Edite somente o arquivo privado:

```bash
sudoedit /opt/devflow/config/devflow.env
sudo chmod 600 /opt/devflow/config/devflow.env
```

Defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`. Nunca mostre o arquivo completo em ticket ou diagnóstico. O domínio não pode ser compartilhado com outro virtual host.

## 10. Verificação

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
curl --fail --silent https://devflow.exemplo.com/api/health
curl --fail --silent https://devflow.exemplo.com/
```

O relatório da instalação fica em `/opt/devflow/state/installation.json`; a versão instalada fica em `/opt/devflow/state/version.json`. A conclusão exige `healthy`, não apenas `running`.

## 11. Atualização, remoção e recuperação

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

## 12. Limitações da alpha

- sem interface web administrativa para o updater;
- rollback automático implementado, mas ainda sem fault-injection e restore drill na VPS;
- adaptador `fullpassword_nginx` implementado, mas ainda sem ensaio real publicado de Docker, Nginx, certificado e rollback;
- integração automática com Caddy e outros Nginx containerizados ainda indisponível;
- sem prova de renovação automática do certificado;
- sem matriz completa de distribuição/arquitetura em CI;
- sem teste E2E, restore drill, pentest ou aprovação para produção.
