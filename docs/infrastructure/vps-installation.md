# Instalacao em VPS Linux para homologacao

Versao `0.6.3-alpha`. Nao aprovada para producao.

Antes de qualquer nova tentativa em uma VPS com instalacao parcial, preserve evidencias:

```bash
sudo cat /opt/devflow/state/install-transaction.json
docker ps -a --filter name=devflow
docker volume ls --filter name=devflow
sudo find /opt/devflow -maxdepth 3 -type f -printf '%p %m %u:%g\n' | sort
```

Baixe novamente o bootstrap publico, sem executar script por pipe:

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
./install.sh --check --domain dev.example.com --admin-email admin@example.com
sudo ./install.sh --dry-run --domain dev.example.com --admin-email admin@example.com
sudo ./install.sh --resume --firewall-confirmed
```

Em servidor limpo, troque o ultimo comando por:

```bash
sudo ./install.sh
```

Em automacao sem TTY, use explicitamente `--install --domain DOMINIO --admin-email EMAIL --firewall-confirmed`.

Validacao final:

```bash
sudo /opt/devflow/app/scripts/version.sh
sudo /opt/devflow/app/scripts/health.sh
sudo systemctl status devflow-certificate-renewal.timer --no-pager
docker ps --filter name=devflow
```

Para a falha conhecida `failedStage=14-nginx-https` da versao `0.5.2-alpha`, use primeiro `--resume --firewall-confirmed`. A retomada ativa `/opt/devflow/app` antes do updater, preserva PostgreSQL/backend/frontend saudaveis e remove `installation-in-progress` somente apos Super Admin, health e `installation.json` aprovados.

Depois da retomada, valide:

```bash
sudo /opt/devflow/app/scripts/version.sh
sudo /opt/devflow/app/scripts/health.sh
docker ps --filter name=devflow --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs --tail 100 devflow-updater
docker logs --tail 100 devflow-worker
sudo stat /opt/devflow/app /opt/devflow/config/super-admin-temporary-password
```

## Homologacao de e-mail

Edite somente `/opt/devflow/config/devflow.env`, mantenha `root:root 0600` e configure as variaveis descritas em `docs/architecture/notifications-email.md`. Depois de uma atualizacao transacional para esta versao:

```bash
sudo /opt/devflow/app/scripts/health.sh
docker inspect --format '{{.State.Health.Status}}' devflow-worker
docker logs --tail 100 devflow-worker
```

No DevFlow, entre como Super Admin, abra Sistema > Atualizacoes e enfileire o teste SMTP. Valide entrega, TLS, retry com provedor temporariamente indisponivel e ausencia de credenciais/conteudo nos logs. Depois teste link expirado, link ja usado, resposta neutra para e-mail inexistente, revogacao das sessoes e preferencias. Nao exponha `devflow.env` ou tokens ao coletar evidencias.

Docker real, Certbot real, ACME real, SMTP real, worker em container, AMD64/ARM64 reais e a recuperacao operacional para `0.5.5-alpha` dependem da execucao manual na VPS.

## Recuperacao manual do estado da instalacao 0.5.3-alpha

O procedimento abaixo deve ser executado pelo operador; ele nao foi executado nesta estacao. Nao substitua por `curl | bash`.

```bash
cd /tmp
git clone https://github.com/trinityrrocha/DevFlow.git DevFlow-repair
cd DevFlow-repair
git switch main
git pull --ff-only origin main
sudo ./scripts/repair-installation-state.sh --check
sudo ./scripts/repair-installation-state.sh --repair
```

O modo `--repair` ja executa o `health.sh` da copia nova em processo separado. Nao execute ainda o `health.sh` de `/opt/devflow/app`: enquanto a release ativa for `0.5.3-alpha`, esse arquivo ainda contem o parser que motivou o reparo. Em seguida, a atualizacao continua pertencendo exclusivamente ao motor transacional:

```bash
sudo ./scripts/update.sh --check
sudo ./scripts/update.sh
sudo /opt/devflow/app/scripts/version.sh
sudo /opt/devflow/app/scripts/health.sh
```

Revise a saida de `--check` antes de usar `--repair`. O script falha fechado se a release, o commit, qualquer container, certificado, migration, Super Admin ou arquivo de senha nao puder ser confirmado.
