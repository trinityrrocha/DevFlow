# Rastreabilidade

## Instalacao isolada `0.5.1-alpha`

| Requisito | Evidencia |
|---|---|
| DNS/IP | `fetch_public_ipv4`, `resolve_domain_ipv4`, `validate_dns_alignment` |
| Portas/firewall | `inspect_ports`, confirmacao numerica externa |
| Certificado | Certbot standalone e `validate_devflow_certificate` |
| Nginx | `docker/nginx.runtime.conf.template` e renderizacao atomica |
| Persistencia | `/opt/devflow`, volume PostgreSQL e fila updater |
| Retomada | `recalculate_resume_stage` e transacao schema 3 |
| Administrador | bootstrap interno, senha `root:root 0600`, MFA obrigatorio |
| Renovacao | `renew-certificate.sh` e timer systemd |
| Update | pedido HMAC -> updater -> somente `update.sh` |
| Rollback | backup autenticado, manutencao, restore e health |
| Desinstalacao | recursos DevFlow e certificado nomeado, sem prune global |
| Testes | 30 cenarios no validador de alinhamento |

O Full Password permaneceu referencia somente leitura no commit `804008b5df5d0931ec5d95227fed44086f430d76`.
