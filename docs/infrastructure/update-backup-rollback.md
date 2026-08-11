# Atualizacao, backup e rollback

`scripts/update.sh` e o motor oficial e nao interativo. O terminal usa `scripts/update-cli.sh`; o frontend cria somente um pedido `install-update` assinado, validado pela fila privada do `devflow-updater`. Nenhuma camada web implementa download, migration, Compose ou rollback.

## Update

1. bloqueia concorrencia com `flock`;
2. valida estado isolado schema v3 e checkout canonico;
3. consulta `origin/main`, versao e changelog;
4. captura `previous_app_target`, snapshot e hash de `installation.json`, migrations e IDs das imagens anteriores;
5. cria backup criptografado vinculado ao ID da transacao e valida manifesto, identidade, timestamp e hashes;
6. prepara release imutavel e imagens `candidate-<commit>`, preservando as anteriores como `rollback-<commit>`;
7. valida migrations como `devflow`;
8. ativa manutencao em 80/443;
9. aplica migrations e registra `databaseMutated=true` antes da execucao quando o alvo difere da migration instalada;
10. recria `db`, `backend`, `frontend`, `worker` e `edge` conforme a allowlist interna, sem recriar o updater durante seu proprio pedido;
11. executa o candidate health com versao, commit e migration explicitos, mantendo `installation.json` anterior;
12. promove atomicamente `/opt/devflow/app`, grava e valida `installation.json`, e executa health instalado interno estrito;
13. retira manutencao, executa health publico e somente entao confirma a transacao.

Existem tres gates independentes: pre-update health valida a release instalada; candidate health valida a candidata sem consultar sua identidade em `installation.json`; final installed health volta a exigir correspondencia estrita entre configuracao, release, estado, imagens, API e migration.

Em qualquer falha depois do armamento, o motor mantem HTTP 503, para backend/worker, autentica exclusivamente o backup da transacao e, quando `databaseMutated=true`, restaura banco e uploads antes de tocar na release anterior. Depois restaura atomicamente o symlink, o snapshot exato de `installation.json`, as imagens anteriores e a topologia antiga. O health antigo e bloqueado enquanto `databaseRestored` nao for verdadeiro. Manutencao somente e retirada depois do health publico antigo aprovado; falha de restore termina com `manualRecoveryRequired=true` e ambiente mantido em manutencao.

`/opt/devflow/state/update-transaction.json` usa schema v2 e registra versoes, commits, releases, migrations, backup/hash, snapshot/hash, IDs/tags de imagens, promocao, restore e estado final. Os unicos resultados finais sao `success`, `rolled-back` ou `failed`; rollback aprovado usa `rollbackStatus=successful`.

O motor aceita somente os remotes `https://github.com/trinityrrocha/DevFlow`, sua variante `.git`, ou `git@github.com:trinityrrocha/DevFlow.git`. Arquivos rastreados alterados bloqueiam o processo com `update_blocked=dirty-worktree`; nenhum `reset --hard`, `clean` ou checkout forcado e usado. A API nao fornece nomes de servicos. O daemon injeta `UPDATE_SERVICES='db backend frontend worker edge'` e a imagem do updater somente deve ser recriada fora do request que ele processa.

Depois que o status do request for `completed` ou `failed`, uma manutencao controlada pode promover o daemon da release ativa. Essa promocao e obrigatoria uma vez ao migrar de uma versao anterior a `0.6.4-alpha`, pois o daemon antigo ainda chamava a interface removida `--request-file`. Nunca execute estes comandos enquanto existir JSON em `processing/`:

```bash
sudo docker exec devflow-updater sh -c '! find /var/lib/devflow/updater/processing -maxdepth 1 -name "*.json" -print -quit | grep -q .'
cd /opt/devflow/app
sudo docker compose --project-name devflow --env-file /opt/devflow/config/devflow.env build updater
sudo docker compose --project-name devflow --env-file /opt/devflow/config/devflow.env up -d --no-deps --wait updater
```

O operador deve validar `devflow-updater` como `healthy` depois da recriacao. Esse passo ocorre fora do request para que o daemon nunca interrompa a operacao que esta processando.

## Interfaces

```bash
sudo /opt/devflow/app/scripts/update-cli.sh --check
sudo /opt/devflow/app/scripts/update-cli.sh
```

O check informa `installed_version`, `installed_commit`, `available_version`, `available_commit` e `update_available`. O CLI usa `/dev/tty`, apresenta changelog e plano, e chama o motor somente apos a opcao `1`. A opcao `2` retorna cancelamento normal sem alteracoes.

Pedidos do painel percorrem `requests/`, `processing/` e `processed/` ou `failed/`. O status sanitizado fica em `status/` e usa `pending`, `processing`, `backup`, `maintenance`, `migrations`, `containers`, `health`, `rollback`, `completed` e `failed`. O stdout bruto nunca e retornado pela API.

Instalacoes antigas podem obter a interface atual sem mutar diretamente a aplicacao:

```bash
wget -O update-devflow.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/update-bootstrap.sh
chmod +x update-devflow.sh
sudo ./update-devflow.sh
```

O bootstrap usa checkout temporario da `main`, valida remote, commit e versao, executa o novo CLI, remove o temporario e propaga o exit code.

## Backup

O backup contem dump PostgreSQL, uploads, manifesto e checksums dentro de envelope criptografado. A passphrase permanece em `/opt/devflow/config/backup.passphrase` com modo `0600`.

```bash
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/verify-backup.sh /opt/devflow/backups/ARQUIVO.dfbackup
```

## Restore

```bash
sudo env CONFIRM_RESTORE='RESTAURAR BACKUP' \
  /opt/devflow/app/scripts/restore.sh /opt/devflow/backups/ARQUIVO.dfbackup
```

A restauracao valida tamanho, caminhos, tipos de arquivo, hashes e envelope antes de alterar banco ou uploads. Sessoes existentes sao revogadas.
