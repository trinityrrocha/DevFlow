# Rastreabilidade

## Instalacao isolada `0.6.3-alpha`

| Fase 4 | Evidencia |
|---|---|
| Outbox confiavel | migration `006_reliable_notifications.sql`, `emailOutboxService.js` e `FOR UPDATE SKIP LOCKED` |
| Recuperacao | `/api/auth/password/forgot`, `/password/reset`, hash SHA-256, expiracao, uso unico e rate limit |
| Notificacoes | contador/lista/leitura/paginacao em `/api/notifications` e menu superior |
| Preferencias | `notification_preferences`, perfil do usuario e seguranca critica obrigatoria |
| Worker | servico `devflow-worker`, retry/backoff, payload AES-256-GCM e auditoria sanitizada |

| Fase 3 | Evidencia |
|---|---|
| Roadmap sem vazamento | `canViewTask`, predicados de lista/dashboard/notificacoes e resposta 404 uniforme |
| Estimativa | migration `005_task_visibility_timers.sql`, segundos no banco e parser `dd-hh-mm` |
| Cronometro | `taskTimingService.js`, lock de linha, timestamps e acumulado persistido |
| Atraso | calculo backend, filtro, listagem/detalhe, `OVERDUE` e auditoria `TASK_OVERDUE` |
| Historico | `task_timer_events` exibido junto ao dossie tecnico |

| Fase 2 | Evidencia |
|---|---|
| Telefone E.164 | migration `004_user_identity_sessions.sql`, `phoneSchema` e formularios de Perfil/Equipe |
| Troca do proprio e-mail | `/api/users/profile/email-change` e `/email-confirm`, token SHA-256 com expiracao |
| Administracao de usuarios | `/api/users/:id`, password-reset, mfa-reset e revogacao de sessoes |
| Sessoes auditaveis | `session_events`, `/api/audit/sessions` e card Sessoes na Auditoria |
| Hierarquia | `assertCanManage`, protecao do ultimo Super Admin/Admin e testes de negacao |

| Fase 1 | Evidencia |
|---|---|
| Navegacao superior | `frontend/src/layouts/DashboardLayout.jsx` e `frontend/src/navigation.test.js` |
| Rotas compativeis | `frontend/src/App.jsx`, `frontend/src/navigation.js` |
| Clientes | `/api/catalogs/clients`, `frontend/src/pages/Clients.jsx` |
| Projetos/equipe | `/api/catalogs/projects`, `frontend/src/pages/Projects.jsx` |
| Autorizacao | migration `003_navigation_catalog_permissions.sql` e `catalogAuthorization.test.js` |

## Infraestrutura preservada

| Requisito | Evidencia |
|---|---|
| DNS/IP | `fetch_public_ipv4`, `resolve_domain_ipv4`, `validate_dns_alignment` |
| Interface publica | sem argumentos -> `--install`; 10 cenarios em `validate-bootstrap-interface.mjs` |
| Portas/firewall | `inspect_ports`, confirmacao numerica externa |
| Certificado | Certbot standalone e `validate_devflow_certificate` |
| Nginx | `docker/nginx.runtime.conf.template` e renderizacao atomica |
| Persistencia | `/opt/devflow`, volume PostgreSQL e fila updater |
| E-mail | outbox no PostgreSQL e worker interno sem porta publicada |
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
