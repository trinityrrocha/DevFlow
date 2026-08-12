# Troubleshooting

## Operacao de backup permanece em processamento com HTTP 503

Verifique sem expor o conteudo dos arquivos:

```bash
grep '^DEVFLOW_OPS_GID=' /opt/devflow/config/devflow.env
stat -c '%U:%G %a %n' /opt/devflow/updater /opt/devflow/updater/status
find /opt/devflow/updater/status -maxdepth 1 -type f -name '*.json' -printf '%u:%g %m %p\n'
docker exec devflow-backend id
```

O esperado e diretorio `root:<ops> 2750`, status `root:<ops> 0640` e o GID operacional presente nos grupos do backend. Nao aplique `chmod 777`; execute a atualizacao oficial ou o diagnostico para reconciliar somente a allowlist.

## Portas 80/443 ocupadas

O instalador imprime `port=` e `owner=` e encerra sem alteracoes. Libere as portas manualmente ou use outra VPS. Nao altere containers de terceiros pelo instalador.

## DNS nao resolve

Confirme todos os registros A e aguarde propagacao. O certificado nao e solicitado se as duas fontes de IPv4 publico divergirem ou se qualquer conjunto DNS nao contiver o IP da VPS.

## ACME falha

Confirme que DNS A aponta para a VPS, 80/443 chegam pelo firewall externo e nenhum processo ocupa as portas. O instalador usa Certbot standalone; nao existe Nginx temporario nem webroot ACME. Em uma tentativa parcial, somente `devflow-nginx` e parado, os demais containers permanecem, e a transacao registra `07-certificate` para `--resume`.

## Migration sem permissao

Nao execute como root nem edite a imagem. O backend exige `/database` e `/database/migrations` em `0755 root:root` e SQLs em `0644 root:root`.

## Diagnostico

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/diagnostic.txt
```

O relatorio e sanitizado e nao inclui ambiente privado, tokens, chaves, dados pessoais ou anexos.

## Estado instalado schema v3 invalido

Use uma copia limpa e atual do repositorio para diagnosticar o estado, sem reinstalar:

```bash
cd /tmp/DevFlow
sudo ./scripts/repair-installation-state.sh --check
```

Se o diagnostico confirmar release, commit, containers, certificado, migration, Super Admin e credencial preservados, repare somente o JSON:

```bash
sudo ./scripts/repair-installation-state.sh --repair
```

O reparador cria um backup `installation.json.backup-<UTC>`, executa o health da copia nova em processo separado, nao executa build/migration e nao altera banco, certificado, Super Admin ou senha. Nao use o reparador se qualquer pre-condicao material falhar. Em `0.5.3-alpha`, execute o health de `/opt/devflow/app` somente depois de concluir a atualizacao para `0.5.4-alpha`, pois a release antiga ainda possui o parser defeituoso.

## MFA e CSRF

MFA e opcional por padrao; a troca da senha temporaria continua obrigatoria. Um usuario que ja habilitou MFA continua informando o segundo fator no login. Se a API responder `CSRF_INVALID`, o cliente renova o token e repete somente uma vez. `FORBIDDEN`, `MFA_POLICY_FORBIDDEN` e falhas de sessao nao acionam esse retry.

## Update falhou

Consulte o ultimo `update-report.txt` e log sanitizado. O motor tenta somente rollback operacional de release, estado, imagens, containers e Nginx isolado. Ele nao restaura banco/uploads. Se `database_mutated=true`, revise `manual_data_restore_may_be_required` antes de decidir por um restore administrativo.

Se a tentativa terminou com `rollback_status=failed`, nao inicie outro update. Primeiro colete o estado sem imprimir o arquivo de ambiente:

```bash
sudo /opt/devflow/app/scripts/version.sh
sudo /opt/devflow/app/scripts/health.sh || true
sudo python3 /opt/devflow/app/scripts/validate-installation-state.py validate /opt/devflow/state/installation.json || true
sudo python3 - <<'PY'
import json
from pathlib import Path
for name in ('installation.json',):
    path = Path('/opt/devflow/state') / name
    if path.is_file():
        data = json.loads(path.read_text())
        allowed = ('installedVersion', 'installedCommit', 'migration', 'applicationHealthy')
        print(name, {key: data[key] for key in allowed if key in data})
PY
sudo docker ps --filter name=devflow --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
sudo docker exec devflow-postgres sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"'
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/post-update-failure-diagnostic.txt
```

Compare migration, release, `installation.json`, containers, transacao e hash do `backupPath`. Nao presuma que o banco retornou a migration anterior. Com essas evidencias, escolha conscientemente entre reparar o ambiente atual ou realizar instalacao limpa; a escolha depende do estado material observado na VPS.
