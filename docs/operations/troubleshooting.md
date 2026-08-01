# Troubleshooting operacional

## Diagnóstico seguro

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
```

O relatório omite valores de ambiente, credenciais, anexos e dados pessoais. Revise-o antes de compartilhar mesmo assim.

Para uma resposta operacional objetiva e a identidade das releases:

```bash
sudo /opt/devflow/app/scripts/health.sh
sudo /opt/devflow/app/scripts/version.sh --all --refresh
```

## Docker ou Compose indisponível

```bash
sudo systemctl status docker
docker version
docker compose version
```

O instalador exige Docker 24+ e Compose v2 2.20+. Não reinstale Docker manualmente sobre uma instalação existente sem entender a origem dos pacotes.

## Porta ocupada

```bash
sudo ss -ltnp
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Não pare o proprietário da porta. Escolha `shared` com portas loopback livres ou reprograme a instalação.

## `fullpassword_nginx` detectado

Esse resultado é um gate, não um erro a contornar. O instalador não modifica o container. Prepare um ponto de extensão persistente e reversível conforme o [guia de VPS](../infrastructure/vps-installation.md#6-coexistência-com-full-password).

## Falha no Nginx

```bash
sudo nginx -t
sudo systemctl status nginx
sudo head -n 3 /etc/nginx/conf.d/devflow.conf
```

O arquivo precisa começar com o marcador DevFlow. O instalador restaura a versão anterior quando uma candidata falha. Não edite configurações de outra aplicação.

## Certificado não emitido

Confirme DNS, porta 80 e virtual host:

```bash
getent ahosts devflow.exemplo.com
sudo ss -ltnp | grep -E ':(80|443)\b'
sudo certbot certificates
```

Não reutilize certificado de outro domínio nem copie chave privada para o repositório.

## Banco não fica saudável

```bash
cd /opt/devflow/app
sudo docker compose --env-file /opt/devflow/config/devflow.env -p devflow ps
sudo docker compose --env-file /opt/devflow/config/devflow.env -p devflow logs --tail 50 db
```

Não execute migration manual com schema inconsistente. Preserve o banco e investigue permissões de `/opt/devflow/data/postgres`, capacidade e healthcheck.

## Migration falhou

Na instalação inicial, a release não é promovida. Durante update, a falha aciona automaticamente o backup pré-update e os containers anteriores. Não marque a migration, não altere `schema_migrations` e não repita o comando manualmente.

## Update não encontra o GitHub

O checkout `/opt/devflow/source` é protegido e o fetch não abre prompt interativo. Confirme:

```bash
sudo git -C /opt/devflow/source status --short
sudo git -C /opt/devflow/source remote -v
sudo ssh -T git@github.com
```

Use uma deploy key somente leitura exclusiva do repositório ou outra credencial de leitura protegida para `root`. Não coloque token na URL, no `.env` ou no repositório. Não altere o remote para contornar a validação.

## Update falhou e executou rollback

Consulte primeiro os resultados sanitizados:

```bash
sudo cat /opt/devflow/data/update-report.txt
sudo ls -lt /opt/devflow/logs/update-*.log
sudo /opt/devflow/app/scripts/health.sh
```

`rollback=success` significa que dados, release, containers e proxy anteriores passaram pelos checks. Preserve o backup e o log para investigar a fase registrada. `rollback=failed` exige congelar novas operações, preservar a VPS e revisar cada falha antes de qualquer restore manual.

Se uma página `503` permanecer, não derrube containers por tentativa. Verifique o modo do proxy, `devflow-maintenance`, o virtual host gerenciado e o relatório. O updater tenta retirar a manutenção mesmo quando o rollback encontra outra falha.

## Backend ou frontend `running`, mas não `healthy`

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
curl --fail --verbose https://devflow.exemplo.com/api/health
```

`running` não encerra o gate. Verifique migration, versão esperada, DNS, proxy e healthcheck antes de considerar uma nova tentativa.

## Recuperação

Preserve `/opt/devflow/config`, `/opt/devflow/data`, `/opt/devflow/storage` e `/opt/devflow/backups`. Consulte [atualização, backup e rollback](../infrastructure/update-backup-rollback.md) antes de restaurar. Não use `docker system prune`, não apague volumes por tentativa e não remova recursos do Full Password.
