# DevFlow

Plataforma multi-tenant de governanca do desenvolvimento. Cada tarefa funciona como um dossie tecnico permanente, com historico, comentarios, anexos, testes, commits, versoes e auditoria.

> **O DevFlow encontra-se em fase de homologacao e ainda nao foi aprovado para uso em producao.**

Versão atual: **0.5.0-alpha**. O DevFlow oferece exclusivamente instalacao isolada: Nginx, certificados, containers, redes, storage, banco e atualizacoes proprios.

## Instalacao rapida

Em uma VPS Ubuntu 22.04 ou 24.04 com DNS apontado para o servidor e portas 80/443 livres:

```bash
wget -O install.sh \
  https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
sudo ./install.sh
```

O instalador pergunta somente:

```text
Dominio do DevFlow:
E-mail administrativo:
```

O mesmo e-mail identifica o Super Administrador e o contato ACME. A conta e criada automaticamente com troca de senha e MFA obrigatorios. A senha temporaria fica protegida em `/opt/devflow/config/super-admin-temporary-password` (modo `0600`) e nenhum segredo e exibido pelo instalador.

## Automacao e diagnostico

```bash
./install.sh --check
sudo ./install.sh --dry-run \
  --domain dev.example.com \
  --admin-email admin@example.com
sudo ./install.sh --install \
  --domain dev.example.com \
  --admin-email admin@example.com
sudo ./install.sh --resume
```

Parametros de proxy compartilhado, provider, escopo interno e e-mails separados foram descontinuados e retornam erro explicito.

## Arquitetura isolada

- `devflow-nginx`: unico servico publicado em 80/443;
- `devflow-frontend`: somente rede `devflow_edge`;
- `devflow-backend`: redes `devflow_edge` e `devflow_internal`;
- `devflow-db`: somente `devflow_internal`, sem porta no host;
- `devflow-certbot`: operacao ACME explicita;
- persistencia integral sob `/opt/devflow`;
- migrations `root:root 0755/0644`, legiveis e nao gravaveis por `devflow`.

O DevFlow nao usa proxy, rede, certificado, container ou arquivo de outra aplicacao.

## Operacao

```bash
sudo /opt/devflow/app/scripts/health.sh
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/diagnostic.txt
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/update.sh --check
sudo /opt/devflow/app/scripts/update.sh
sudo /opt/devflow/app/scripts/uninstall.sh
```

`update.sh` e o unico motor de atualizacao. O contrato operacional em `update-operation.sh` permite que uma futura API autenticada reutilize o mesmo processo, sem aceitar comandos arbitrarios.

## Documentacao

- [Instalacao](docs/infrastructure/installation.md)
- [VPS de homologacao](docs/infrastructure/vps-installation.md)
- [Infraestrutura](docs/infrastructure/infrastructure.md)
- [Update, backup e rollback](docs/infrastructure/update-backup-rollback.md)
- [Seguranca](docs/security/security-baseline.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Estado de implementacao](docs/implementation-status.md)

Os Documentos 001, 002 e 003 formam a baseline funcional. O Documento 004 ainda nao foi executado.
