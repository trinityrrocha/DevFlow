# Atualizacao, backups e rollback

O DevFlow `0.6.30-alpha` usa um WebUpdater Docker Compose simples, baseado no fluxo operacional do Full Password. Backups continuam independentes: `scripts/update.sh` nao cria, verifica, exige nem restaura backups. O Super Admin decide se deseja criar um ponto de restauracao em **Sistema > Backups**.

## Fluxo do WebUpdater

1. O frontend envia um pedido `install-update` autenticado, autorizado para Super Admin e protegido por CSRF.
2. O backend grava JSON atomico com HMAC, nonce e ID em `requests/`.
3. O daemon valida assinatura, replay e allowlist, move para `processing/` e adquire `/run/lock/devflow/operations.lock`.
4. `update.sh` executa pre-health e consulta `origin/main` em checkout isolado com `git fetch`, `git checkout main` e `git pull --ff-only`.
5. A release final `releases/<commit>` e criada; backend, frontend e a proxima imagem do updater recebem somente `release-<commit>`.
6. O contrato das migrations e validado antes de parar writers. Backend, worker, frontend e edge sao parados pelo menor intervalo pratico.
7. O banco sobe, migrations rodam sob o mesmo lock e `db/backend/worker/frontend/edge` sobem com `--wait`.
8. O estado instalado, o symlink e o health confirmam a identidade. Somente entao o checkout operacional recebe fast-forward para o mesmo commit.
9. O pedido termina em `processed/`; qualquer falha termina em `failed/`.

O changelog e apenas informativo. Sua ausencia, formato invalido ou secao incompleta nao altera deteccao, build, migrations, health, sucesso ou falha. A tela mostra somente versao instalada, versao disponivel e o botao de update.

## Rollback operacional pequeno

Antes de qualquer mutacao, as imagens instaladas recebem a tag normal `release-<commit-antigo>` e `installation.json` e copiado com modo `0600`. Se uma etapa posterior falhar, o motor restaura o symlink, as tres variaveis gerenciadas, o estado e `db/backend/worker/frontend/edge` usando essa tag normal. Tags `rollback-*` e `candidate-*` antigas sao removidas quando nao estao em uso.

Se uma tentativa legada ja tiver deixado `/opt/devflow/source` adiante da release instalada, o rollback constroi um checkout limpo temporario no commit antigo, troca os diretorios por rename atomico e so remove a copia adiantada depois de confirmar branch `main` e commit. Nao usa `git reset --hard`, `git clean` ou force checkout.

Nao existe down migration automatico. Se migrations chegaram a iniciar, `update-report.txt` registra `manualRecoveryRequired=true`; o operador deve avaliar compatibilidade de dados antes de um restore administrativo. O rollback nunca afirma restauracao integral do banco ou de uploads.

O container `devflow-maintenance` permanece disponivel para restore de backup, mas nao participa do WebUpdater. Durante o curto restart, o browser tolera 404/502/503/reset, consulta `/api/health` ate o backend voltar e depois retorna ao status do pedido. O polling de notificacoes fica pausado somente enquanto o pedido de update esta ativo.

## Compatibilidade com 0.6.26-alpha

O motor antigo executa, depois do `git pull`, `render_runtime_nginx_config`. A funcao valida `/etc/letsencrypt` no filesystem do updater, embora o Compose 0.6.26 monte certificados apenas no Nginx. O retorno 1 aciona o trap. `write_update_transaction rollback-started` sobrescreve `UPDATE_PHASE`, por isso o log mostra incorretamente `rollback-started` em vez da fase original `source`.

O processo 0.6.26 ja carregou o script antigo e nao consulta um motor remoto antes desse erro. Portanto, a primeira passagem exige o bootstrap unico abaixo; pedidos posteriores funcionam pelo painel:

```bash
wget -O update-devflow.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/update-bootstrap.sh
chmod +x update-devflow.sh
sudo ./update-devflow.sh
```

Nao use `curl | bash`. O bootstrap clona uma copia temporaria, valida repositorio, commit e contrato de versao e executa o motor novo. A homologacao real na VPS permanece responsabilidade do usuario.

## Backups no painel

As operacoes `create-backup`, `verify-backup`, `restore-backup` e `delete-backup` continuam usando a fila HMAC e o mesmo lock global. Restore possui fluxo proprio com manutencao e backup de seguranca. Essa funcionalidade nao foi alterada pela refatoracao do WebUpdater.

O download usa `GET /api/operations/backups/:id/download` e nao passa pela fila porque e somente leitura. O backend monta `${BACKUP_ARCHIVE_DIR}` em `/var/lib/devflow/backups:ro`; o catalogo fornece o nome allowlisted e o servico valida caminho canonico, tipo regular e tamanho antes de iniciar o streaming. A permissao de grupo operacional e reconciliada pelo daemon para backups existentes e aplicada a cada novo arquivo.

## CLI

```bash
sudo /opt/devflow/app/scripts/update-cli.sh --check
sudo /opt/devflow/app/scripts/update-cli.sh
sudo /opt/devflow/app/scripts/version.sh --all --refresh
sudo /opt/devflow/app/scripts/health.sh
```
