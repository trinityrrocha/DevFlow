# DevFlow

Plataforma multi-tenant de governanca do desenvolvimento. Cada tarefa funciona como um dossie tecnico permanente, com historico, comentarios, anexos, testes, commits, versoes e auditoria.

> **O DevFlow encontra-se em fase de homologacao e ainda nao foi aprovado para uso em producao.**

Versao atual: **0.6.25-alpha**. Esta revisao adiciona temas claro e escuro, alternância acessível no header e login, persistência local e preferência do sistema na primeira visita.

Rotas canonicas autenticadas: `/dashboard`, `/task`, `/team`, `/clients`, `/projects`, `/audit`, `/settings/security/mfa`, `/settings/modules/catalogs`, `/settings/modules/workflows`, `/settings/server/smtp`, `/settings/updates` e `/profile`. As rotas anteriores `/`, `/tasks`, `/users` e `/settings` redirecionam para os destinos equivalentes.

## Instalacao

Requisitos: Ubuntu 22.04/24.04 AMD64 ou ARM64, DNS A apontado para a VPS, portas publicas 80/443 livres, 2 GiB de RAM e 5 GiB livres.

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
sudo ./install.sh
```

Sem argumentos, o bootstrap seleciona a instalacao interativa, solicita dominio e e-mail, executa o preflight e exige duas confirmacoes numericas antes de alterar o host. Para automacao, continuam disponiveis `--check`, `--dry-run`, `--install` e `--resume`.

O instalador exige confirmacoes numericas; o bootstrap transforma a chamada publica sem argumentos em `--install` explicito e nunca atualiza uma instalacao concluida. O e-mail informado e a autoridade unica para Super Admin e Let's Encrypt. Depois do health final, o logger e drenado e a senha temporaria e exibida uma unica vez no TTY original; o bloco de credenciais e a ultima saida visivel. O arquivo permanece em `/opt/devflow/config/super-admin-temporary-password`, `root:root 0600`, sem aparecer em logs. Sem TTY, os metadados finais ficam somente no log e a senha nao e exibida.

MFA e recomendado, mas opcional por padrao. Quem o habilita continua obrigado a informar o segundo fator no login. O Super Admin pode alterar a politica persistente em **Cadastros e configuracao > Politica de autenticacao multifator** para `optional`, `admins` ou `all`; a mudanca e protegida por CSRF, auditada e nao desabilita fatores ja cadastrados.

Para uma tentativa parcial, inspecione primeiro o estado e retome:

```bash
sudo cat /opt/devflow/state/install-transaction.json
docker ps -a --filter name=devflow
docker volume ls --filter name=devflow
sudo ./install.sh --resume --firewall-confirmed
```

`--resume` ignora a etapa historica como fonte de verdade e recalcula o ponto material a partir de certificado, config Nginx, imagens, containers, banco, migration e bootstrap administrativo. Uma falha no estagio 14 ativa a nova release em `/opt/devflow/app`, recria updater/edge quando necessario e preserva os servicos saudaveis anteriores.

## Arquitetura operacional

- `devflow-nginx`: unico servico publicado nas portas 80/443;
- `devflow-frontend`: rede de borda, sem porta do host;
- `devflow-backend`: redes de borda e interna, sem porta do host;
- `devflow-worker`: consumidor interno da outbox de e-mail, sem porta e sem execucao arbitraria;
- `devflow-db`: somente rede interna e volume persistente proprio;
- `devflow-updater`: fila privada assinada, delegacao exclusiva ao `update.sh` e bloqueio de processamento enquanto `state/installation-in-progress` existir;
- `/etc/letsencrypt`: certificado do host montado como somente leitura no Nginx;
- `/opt/devflow/config/nginx/nginx.runtime.conf`: configuracao gerada somente apos validar o certificado.

## Operacao

```bash
sudo /opt/devflow/app/scripts/version.sh
sudo /opt/devflow/app/scripts/health.sh
sudo /opt/devflow/app/scripts/repair-installation-state.sh --check
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/diagnostic.txt
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/update-cli.sh --check
sudo /opt/devflow/app/scripts/update-cli.sh
sudo /opt/devflow/app/scripts/renew-certificate.sh --dry-run
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
```

`update.sh` e o motor nao interativo: valida a allowlist de `origin`, usa apenas `fetch`, `checkout main` e `pull --ff-only`, cria e verifica backup, ativa manutencao, aplica todas as migrations pendentes, valida health e executa rollback automatico em falha. A confirmacao manual pertence a `update-cli.sh`; no painel, pertence ao frontend antes da criacao do pedido HMAC. O instalador permanece exclusivo da instalacao inicial.

Para atualizar uma VPS antiga que ainda possui o CLI defeituoso, baixe o bootstrap sem usar pipe:

```bash
wget -O update-devflow.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/update-bootstrap.sh
chmod +x update-devflow.sh
sudo ./update-devflow.sh
```

Para uma instalacao `0.5.3-alpha` cujo unico erro seja o estado schema v3, obtenha uma copia limpa da `main` e execute primeiro `sudo scripts/repair-installation-state.sh --check`. Use `--repair` somente depois de revisar o diagnostico. O reparador nao instala, nao constroi imagens, nao executa migrations e nao altera banco, Super Admin, senha ou certificado.

## Documentacao

- [Instalacao detalhada](docs/infrastructure/installation.md)
- [VPS de homologacao](docs/infrastructure/vps-installation.md)
- [Infraestrutura](docs/infrastructure/infrastructure.md)
- [Update, backup e rollback](docs/infrastructure/update-backup-rollback.md)
- [Seguranca](docs/security/security-baseline.md)
- [Notificacoes e e-mail](docs/architecture/notifications-email.md)
- [Troubleshooting](docs/operations/troubleshooting.md)
- [Estado de implementacao](docs/implementation-status.md)

Os Documentos 001, 002 e 003 formam a baseline. O Documento 004 ainda nao foi executado.
