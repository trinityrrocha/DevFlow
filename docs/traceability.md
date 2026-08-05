# Rastreabilidade

## Instalacao isolada `0.5.3-alpha`

| Requisito | Evidencia |
|---|---|
| DNS/IP | `fetch_public_ipv4`, `resolve_domain_ipv4`, `validate_dns_alignment` |
| Interface publica | sem argumentos -> `--install`; 10 cenarios em `validate-bootstrap-interface.mjs` |
| Portas/firewall | `inspect_ports`, confirmacao numerica externa |
| Certificado | Certbot standalone e `validate_devflow_certificate` |
| Nginx | `docker/nginx.runtime.conf.template` e renderizacao atomica |
| Persistencia | `/opt/devflow`, volume PostgreSQL e fila updater |
| Retomada | `recalculate_resume_stage` e transacao schema 3 |
| Symlink ativo | `activate_candidate_app_symlink`, rollback e commit atomicos antes do updater |
| Gate da fila | `state/installation-in-progress` e `updater_processing_blocked` |
| Administrador | bootstrap interno, senha `root:root 0600`, MFA obrigatorio |
| Renovacao | `renew-certificate.sh` e timer systemd |
| Update | pedido HMAC -> updater -> somente `update.sh` |
| Rollback | backup autenticado, manutencao, restore e health |
| Desinstalacao | recursos DevFlow e certificado nomeado, sem prune global |
| Testes | 30 cenarios de alinhamento e 24 cenarios do ciclo de instalacao/updater |

O Full Password permaneceu referencia somente leitura no commit `804008b5df5d0931ec5d95227fed44086f430d76`.
