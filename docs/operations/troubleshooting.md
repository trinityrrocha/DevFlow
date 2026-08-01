# Troubleshooting operacional

## Diagnóstico seguro

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
```

O relatório omite valores de ambiente, credenciais, anexos e dados pessoais. Revise-o antes de compartilhar mesmo assim.

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

O instalador não promove a release. Não marque a migration manualmente. Confirme a tabela no PostgreSQL e use o backup pré-update. Downgrade de schema não é automático.

## Backend ou frontend `running`, mas não `healthy`

```bash
sudo /opt/devflow/app/scripts/diagnose.sh
curl --fail --verbose https://devflow.exemplo.com/api/health
```

`running` não encerra o gate. Verifique migration, origem da aplicação, DNS, proxy e healthcheck antes de repetir a atualização.

## Recuperação

Preserve `/opt/devflow/config`, `/opt/devflow/data`, `/opt/devflow/storage` e `/opt/devflow/backups`. Consulte [atualização, backup e rollback](../infrastructure/update-backup-rollback.md) antes de restaurar. Não use `docker system prune`, não apague volumes por tentativa e não remova recursos do Full Password.
