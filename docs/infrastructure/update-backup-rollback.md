# Atualizacao, backup e rollback

`scripts/update.sh` e o unico motor oficial. O terminal o chama diretamente; o frontend cria somente um pedido `install-update` assinado, validado pela fila privada do `devflow-updater`. Nenhuma camada web implementa download, migration ou rollback.

## Update

1. bloqueia concorrencia com `flock`;
2. valida estado isolado schema v3 e checkout canonico;
3. consulta `origin/main`, versao e changelog;
4. exige confirmacao numerica no terminal ou pedido HMAC valido do Super Admin;
5. cria e verifica backup criptografado;
6. prepara release imutavel e imagens;
7. valida migrations como `devflow`;
8. ativa manutencao em 80/443;
9. aplica migrations;
10. recria backend/frontend e proxy DevFlow sem recriar o updater durante seu proprio pedido;
11. valida health interno e externo;
12. promove estado e retira manutencao.

Em qualquer falha depois do armamento, o motor restaura release, configuracao Nginx runtime, backup e containers anteriores, retira manutencao e registra o resultado. O backup e validado antes da primeira mutacao. Nao existe integracao com proxy externo.

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
