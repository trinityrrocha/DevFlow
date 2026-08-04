# Infraestrutura isolada

O Compose do DevFlow e a unica fonte operacional da infraestrutura.

```text
Internet :80/:443
       |
 devflow-nginx --- devflow_edge --- devflow-frontend
       |                  |
       +---------- devflow-backend
                              |
                     devflow_internal
                              |
                         devflow-db
```

`devflow-certbot` compartilha apenas o webroot ACME e o diretorio de certificados. PostgreSQL nao possui porta publicada. Frontend e backend usam `expose`, nunca `ports`. Redes e bind mounts pertencem ao namespace `/opt/devflow`.

O Nginx oferece redirecionamento HTTPS, WebSocket, limites de upload, buffers, timeouts, gzip, rate limiting, CSP, HSTS e headers de seguranca. Durante ACME, somente o challenge HTTP fica disponivel; a aplicacao pode responder 503.

A renovacao e executada por `devflow-certificate-renewal.timer`, que chama o servico Certbot do Compose e recarrega somente `devflow-nginx`.
