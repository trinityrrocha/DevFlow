# Instalacao isolada

O DevFlow 0.5.0-alpha possui um unico modo de instalacao. O servidor deve executar Ubuntu 22.04 ou 24.04, possuir DNS valido e disponibilizar exclusivamente as portas 80/443 ao DevFlow.

## Fluxo comum

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
sudo ./install.sh
```

O instalador solicita dominio e um unico e-mail administrativo, apresenta resumo numerico e executa 16 etapas transacionais: preflight, diretorios, fonte, configuracao, imagens, redes, banco, migrations, backend, frontend, Nginx HTTP, certificado, Nginx HTTPS, Super Admin, health e estado final. A conta administrativa e criada pela API interna; sua senha temporaria fica em `/opt/devflow/config/super-admin-temporary-password` com modo `0600`, exigindo troca e MFA no primeiro acesso.

## Preflight

O preflight valida Linux, Ubuntu suportado, AMD64/ARM64, root, memoria, disco, Git, curl ou wget, OpenSSL, Docker/Compose, DNS e portas. Dependencias base e Docker/Compose ausentes sao apresentados como instalacao planejada e obtidos somente dos repositorios oficiais depois da confirmacao. Se 80 ou 443 estiver ocupada, informa porta e proprietario e encerra sem adaptar o processo existente.

## Persistencia

```text
/opt/devflow/
  app -> releases/<commit>
  source/
  releases/
  config/
  state/
  logs/
  backups/
  storage/postgres/
  storage/uploads/
  storage/acme/
  certificates/
```

Excecoes no host: quatro unidades systemd exclusivas do DevFlow e locks em `/run/lock`. Docker pode ser instalado pelo repositorio oficial quando ausente.

## Retomada

```bash
sudo ./install.sh --resume
```

A retomada exige `install-transaction.json` isolado valido e a configuracao privada existente. Segredos nao sao regenerados silenciosamente.
