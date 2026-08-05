# Rastreabilidade

## Instalacao isolada `0.5.5-alpha`

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
| Administrador | bootstrap interno, senha `root:root 0600`, troca obrigatoria e MFA opcional por padrao |
| Politica MFA | registro persistente `optional`/`admins`/`all`, API Super Admin e auditoria estrita |
| CSRF | cookie/header central, vinculo com sessao, comparacao constante e um retry exclusivo de `CSRF_INVALID` |
| Estado final | schema v3, parser numerico corrigido, validador e health instalados em novo processo |
| Saida final | logger drenado antes do bloco de credenciais; nenhum diagnostico posterior no terminal |
| Reparo de estado | `repair-installation-state.sh --check|--repair`, sem build/migration/mutacao material |
| Renovacao | `renew-certificate.sh` e timer systemd |
| Update | pedido HMAC -> updater -> somente `update.sh` |
| Rollback | backup autenticado, manutencao, restore e health |
| Desinstalacao | recursos DevFlow e certificado nomeado, sem prune global |
| Testes | suites existentes e 40 cenarios adicionais de MFA, CSRF, estado e credencial |

O Full Password permaneceu referencia somente leitura no commit `804008b5df5d0931ec5d95227fed44086f430d76`.
