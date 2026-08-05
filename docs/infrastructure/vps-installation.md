# Instalacao em VPS Linux para homologacao

Versao `0.5.2-alpha`. Nao aprovada para producao.

Antes de qualquer nova tentativa em uma VPS que recebeu `0.5.0-alpha`, preserve evidencias:

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

Docker real, Certbot real, ACME real, AMD64/ARM64 reais e a retomada de estados parciais `0.5.0`/`0.5.1` para `0.5.2` dependem da execucao manual na VPS.
