# Infraestrutura isolada

```text
Internet 80/443 -> devflow-nginx -> devflow-frontend
                           |-----> devflow-backend -> devflow-db
                           |              ^              |
                           |              +-- devflow-worker (outbox SMTP)
                           |             |
                           |       fila privada HMAC
                           |             v
                           +------ devflow-updater -> Docker socket / update.sh
Host Certbot standalone -> /etc/letsencrypt (read-only no Nginx)
```

Somente `devflow-nginx` publica portas. PostgreSQL usa `devflow_internal`, sem porta do host, e o volume nomeado `devflow_postgres_data` aponta para `/opt/devflow/storage/postgres`. O `devflow-worker` compartilha a imagem do backend, conecta apenas a rede interna e processa exclusivamente registros tipados da outbox. Backend e updater montam a mesma fila persistente do host, definida por `DEVFLOW_UPDATER_ROOT` e instalada em `/opt/devflow/updater`; nenhum outro dado e compartilhado entre esses servicos.

O Certbot e um pacote do host e nao um servico permanente do Compose. A configuracao Nginx runtime e gerada atomicamente apos validacao criptografica e montada em `/etc/nginx/conf.d/default.conf:ro`; `/etc/letsencrypt` e montado `:ro`.

O timer systemd chama `renew-certificate.sh`, limita a renovacao ao `DEVFLOW_DOMAIN` e recarrega somente `devflow-nginx` no deploy hook. O dry-run e uma operacao manual.
