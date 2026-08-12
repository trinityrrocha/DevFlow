# Atualizacao, backups e rollback

O DevFlow `0.6.27-alpha` separa atualizacao e gestao de backups. `scripts/update.sh` nao cria, verifica, seleciona nem restaura backups. O Super Admin decide se deseja criar um ponto de restauracao em **Sistema > Backups** antes de atualizar.

## WebUpdater

O painel cria um pedido `install-update` assinado. O daemon valida HMAC e allowlist, adquire `/run/lock/devflow/operations.lock` e executa o motor oficial. O fluxo e: pre-health, consulta de versao/changelog, release candidata, build, manutencao HTTP 503, migrations, containers, candidate health, promocao atomica e health final.

O pedido percorre `requests/`, `processing/` e `processed/` ou `failed/`. O status sanitizado fica em `status/`; stdout, ambiente e segredos nunca sao retornados pela API.

## Rollback operacional

Em falha depois da mutacao, o motor tenta restaurar apenas release/symlink, snapshot de `installation.json`, configuracao gerenciada, IDs das imagens e containers anteriores. Ele nao executa down migrations e nao restaura PostgreSQL ou uploads.

Se uma migration tiver sido iniciada, a transacao schema v3 registra `databaseMutated=true` e `manualDataRestoreMayBeRequired=true`. Se a release anterior nao ficar saudavel com o schema atual, o resultado usa `manualRecoveryRequired=true`, preserva manutencao e nao declara rollback completo. A restauracao de dados exige uma operacao explicita do Super Admin.

## Backups no painel

A rota `/settings/backups` e exclusiva do Super Admin. A API lista um catalogo sanitizado gerado pelo daemon e aceita somente IDs hexadecimais opacos. Paths, comandos e argumentos de shell nunca sao recebidos do navegador.

- `create-backup` chama `scripts/backup.sh`;
- `verify-backup` chama `scripts/verify-backup.sh`;
- `restore-backup` exige `RESTAURAR`, cria e valida um backup de seguranca, valida o selecionado, ativa manutencao, chama `scripts/restore.sh` e executa health;
- `delete-backup` exige `EXCLUIR`, resolve o ID internamente e remove somente o arquivo exato `.dfbackup`.

Todas usam a fila HMAC, polling e o lock operacional global. A retencao continua controlada por `BACKUP_RETENTION_DAYS`, default 30 dias. O timer `devflow-backup.timer` permanece suportado.

O catalogo possui contrato proprio: backups usam apenas `available` ou `verified`; a fila usa `pending`, `processing`, `completed` ou `failed`, com fases internas adicionais. A reconciliacao de auditoria e isolada da leitura do catalogo, portanto um pedido historico invalido nao impede a listagem, enquanto um catalogo realmente corrompido continua falhando fechado.

`verify-backup.sh` e `restore.sh` usam diretorios root-owned `0700` em `/opt/devflow/tmp`; nenhum bind source depende do `/tmp` privado do container updater.

## Compatibilidade com 0.6.24-alpha

A release `0.6.24-alpha` executa `/opt/devflow/app/scripts/update.sh` antes de promover o checkout remoto e falha na verificacao do backup anterior a essa promocao. O `git fetch` nao substitui o shell em execucao. Assim, uma alteracao publicada agora nao consegue modificar automaticamente esse processo ja instalado.

E necessaria uma unica migracao segura, sem pipe:

```bash
wget -O update-devflow.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/update-bootstrap.sh
chmod +x update-devflow.sh
sudo ./update-devflow.sh
```

O bootstrap cria checkout temporario, valida repositorio, commit e contrato de versao, executa o CLI atual e remove o temporario. Depois da promocao, pedidos futuros usam o daemon e o motor novos.

## CLI

```bash
sudo /opt/devflow/app/scripts/update-cli.sh --check
sudo /opt/devflow/app/scripts/update-cli.sh
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/verify-backup.sh /opt/devflow/backups/devflow-ARQUIVO.dfbackup
```

Backups, restores e WebUpdater reais precisam ser homologados pelo usuario na VPS.
