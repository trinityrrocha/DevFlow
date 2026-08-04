# Instalacao em VPS Linux para homologacao

> Versão `0.5.0-alpha`: somente instalacao isolada. Nao aprovada para producao.

Antes de instalar:

- aponte o DNS do dominio para a VPS;
- libere 80/TCP e 443/TCP;
- confirme que nenhuma outra aplicacao usa essas portas;
- use Ubuntu 22.04 ou 24.04 com pelo menos 2 GiB RAM e 5 GiB livres.

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
./install.sh --check
sudo ./install.sh --dry-run --domain dev.example.com --admin-email admin@example.com
sudo ./install.sh
```

Ao terminar:

```bash
sudo /opt/devflow/app/scripts/health.sh
sudo /opt/devflow/app/scripts/version.sh
sudo cat /opt/devflow/state/installation.json
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Esperado:

```text
installation_mode=isolated
external_publication_enabled=true
external_https_status=healthy
overall_health=healthy
```

Docker real, ACME real e ARM64 real dependem da execucao manual nesta VPS.
