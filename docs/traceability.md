# Rastreabilidade

## Instalacao isolada `0.6.22-alpha`

| Revisao 0.6.22 | Evidencia |
|---|---|
| Bind mount | backend e updater usam `${DEVFLOW_UPDATER_ROOT:-/opt/devflow/updater}:/var/lib/devflow/updater` |
| Fila backend | `DEVFLOW_UPDATER_QUEUE_DIR=/var/lib/devflow/updater/requests` |
| Status backend | `DEVFLOW_UPDATER_STATUS_DIR=/var/lib/devflow/updater/status` |
| Raiz daemon | `DEVFLOW_UPDATER_ROOT=/var/lib/devflow/updater` |
| Observabilidade | controller registra o caminho final após `renameSync` atômico |
| Regressão | testes recusam fallback relativo e validam dois mounts idênticos |

## Instalacao isolada `0.6.21-alpha`

| Revisao 0.6.21 | Evidencia |
|---|---|
| Modal QA | `TaskDetail.jsx` usa `CheckboxGroup` para ambiente/perfis e `Select` para Backend/Frontend |
| Perfis reais | `/users/profiles` fornece os perfis técnicos ativos, preservando valores legados ao editar |
| Timeline QA | ordenação decrescente explícita e cards de 350 px em eixo centralizado |
| Timeline anexos | cards `h-[122.15px] w-[350px]` com preview, data, autor, origem e ações |
| Checklist | `StagePrerequisiteChecklist.jsx` separa evidências visuais dos bloqueios obrigatórios fornecidos por `missing_requirements` |
| Avanço | botão mantém o bloqueio do backend e ganha alerta/descrição acessível quando existem pendências |

## Instalacao isolada `0.6.20-alpha`

| Revisao 0.6.20 | Evidencia |
|---|---|
| Compatibilidade | `013_qa_tests_idempotency_repair.sql` atende bancos que ja registraram a 012 anterior com tabela vazia |
| Reparo | a 013 usa `DROP TRIGGER IF EXISTS` e garante `source_section VARCHAR(50)` sem excecao forcada |
| VPS com rollback | como a 012 falhou e nao foi registrada, o banco executara primeiro a 012 corrigida e depois a 013 idempotente |
| Regressao | testes e validador de migrations inspecionam os dois caminhos de upgrade |

## Instalacao isolada `0.6.19-alpha`

| Revisao 0.6.19 | Evidencia |
|---|---|
| Causa raiz | `trg_task_tests_immutable`, criado na migration 001, chamava `prevent_immutable_mutation()` durante o backfill da migration 012 e gerava `P0001` |
| Correcao | `DROP TRIGGER IF EXISTS trg_task_tests_immutable ON task_tests` ocorre antes de `UPDATE task_tests` |
| Modelo atual | o trigger permanece removido porque testes aceitam edicao auditada e exclusao logica por `deleted_at` |
| DDL defensivo | tabela, colunas e indices usam `IF NOT EXISTS`; constraints usam substituicao transacional idempotente |
| Tipos | identificadores permanecem UUID e ambiente/status usam `VARCHAR` com `CHECK`, sem ENUM |
| Regressao | teste garante ordem do drop, ausencia de `RAISE EXCEPTION` e contrato de `source_section VARCHAR(50)` |

## Instalacao isolada `0.6.18-alpha`

| Revisao 0.6.18 | Evidencia |
|---|---|
| Causa raiz da fila | Compose usava um volume Docker opaco enquanto o instalador mantinha a fila persistente em `/opt/devflow/updater` |
| Persistencia | backend e updater montam o mesmo `DEVFLOW_UPDATER_ROOT` em `/var/lib/devflow/updater`; o backend usa `DEVFLOW_UPDATER_QUEUE_DIR=/var/lib/devflow/updater/requests` |
| Gate do daemon | backend somente aceita o POST quando `daemon.ready` e um arquivo regular, nao e symlink e possui heartbeat recente |
| Atualizacao externa | `update.sh` recria o updater ao final apenas no fluxo SSH; o daemon nunca tenta recriar a si proprio |
| Fase 1 | `Settings.jsx` consulta exclusivamente o ciclo de vida do request enquanto a API permanece disponivel |
| Handoff | 404/502/503/504, timeout ou erro de rede ativa `isRebooting` e encerra consultas ao request |
| Fase 2 | durante o reinicio, somente `/api/health` e consultado; o primeiro HTTP 200 executa `window.location.reload()` |
| Regressao | testes cobrem bind compartilhado, heartbeat recente/expirado, handoff e polling exclusivo de health |


| Revisao 0.6.15 | Evidencia |
|---|---|
| Migration | `011_stage_time_tracking.sql` adiciona chegada da etapa, `stage_id` nos eventos e sessoes manuais por usuario |
| Lead time | `task_stage_intervals` abre automaticamente na entrada e fecha na transicao |
| Touch time | `taskTimingService.js` abre/fecha `task_stage_touch_sessions` e vincula eventos a etapa atual |
| Transicao | `transitionTask` encerra sessoes/intervalo anterior, zera o timer e abre a etapa seguinte na mesma transacao |
| Roadmap | backend rejeita timer e frontend omite integralmente o card temporal |
| Anexos | MIME canonico no backend; `<img>`/`<video>` e icones Lucide no frontend |
| Regressao | 82 testes backend, 30 frontend, lint e build de producao locais aprovados |


| Revisao 0.6.14 | Evidencia |
|---|---|
| Ciclo da fila | `updateOperationService.js` procura `requests`, `processing`, `processed` e `failed` em ordem |
| Leitura segura | UUID estrito, `existsSync`, `lstat`, bloqueio de symlink, limite de 8 KiB e validacao de schema/identidade |
| Estado publico | localizacao define pending/processing/completed/failed; `status/` conserva a fase operacional detalhada |
| Polling resiliente | `updatePolling.js` classifica timeout, Network Error e 502/503/504 como interrupcao temporaria |
| Retorno | `Settings.jsx` mantem loading, exibe reinicio e recarrega quando a API responde `completed` |
| Regressao | testes backend percorrem os quatro diretorios; testes frontend cobrem erros transitorios e reload |

| Revisao 0.6.13 | Evidencia |
|---|---|
| Causa raiz | SQL antigo reproduz `42P08` ao inferir `$3` como `text` e `varchar` no mesmo `UPDATE` |
| Integridade | `taskTimingService.js` usa `FOR UPDATE`, casts explicitos e evento na mesma transacao |
| Autoria | `actorId` e `companyId` derivam de `req.user`; payload desconhecido e rejeitado pelo controller |
| Regras | tarefa, permissao, estado ativo, etapa temporizada e timer ja ativo retornam 403/404/409 |
| Diagnostico | falha inesperada gera `[TIMER_ERROR]` interno e resposta 500 generica |
| Regressao | `taskTimerTransaction.test.js` cobre autoria, lock, conflito, permissao e JSON semantico |

| Revisao 0.6.12 | Evidencia |
|---|---|
| Estado do Monaco | `CodeEditor.jsx` usa `defaultValue` no modo editavel; `TaskDetail.jsx` le `editor.getValue()` somente ao salvar |
| Foco e sizing | wrapper com `minHeight=400px`, borda, padding, `onClick` e `focus()` |
| Feedback visual | placeholder nativo e `loading` com spinner sem colapso de layout |
| Digitacao leve | nenhum `setForm` ou deteccao de linguagem e executado no `onChange` do codigo |
| Regressao | `taskExperience.test.js` protege o modelo nao controlado e a area clicavel |

| Revisao 0.6.11 | Evidencia |
|---|---|
| Heap do build | `frontend/Dockerfile` define `NODE_OPTIONS=--max-old-space-size=4096` imediatamente antes do build |
| Chunk Monaco | `frontend/vite.config.js` agrupa `monaco-editor` e `@monaco-editor` no chunk `monaco` |
| Regressao | `buildConfiguration.test.js` protege a ordem do Dockerfile e a configuracao Rollup |
| Homologacao | build Vite validado localmente; build Docker e VPS permanecem pendentes |

| Revisao 0.6.10 | Evidencia |
|---|---|
| Update sem MFA | `updateOperationRoutes.js` remove o gate específico e `authMiddleware.js` libera somente POST do Super Admin durante setup obrigatório |
| CSRF preservado | `app.js` mantém `csrfProtection` antes das rotas e o contrato é exercitado em `updateOperation.test.js` |
| Toggle de tempo | `TaskDetail.jsx` usa um único botão reativo, `timerPending`, spinner e bloqueio concorrente |
| Estado sem 500 cego | `taskController.js` responde JSON 400/404/409; falhas de infraestrutura recebem 500 genérico e log sanitizado |
| Monaco preservado | componente, autodetecção Pascal, validação, migrations 009/010 e autor derivado da sessão continuam cobertos |

| Revisao 0.6.9 | Evidencia |
|---|---|
| Monaco reutilizavel | `CodeEditor.jsx`, workers locais, configuracao comum e tema observado no documento |
| Linguagens | `codeLanguages.js` cobre Pascal/Delphi, PowerShell, modo automatico e escolha manual persistente |
| Validacao | `githubCard.js` exige codigo, allowlist normalizada e maximo de 200000 bytes UTF-8 |
| Historico | autor vem da sessao, etapa vem da tarefa e edicoes nao substituem esses campos |
| Exclusao protegida | migration `010_github_card_soft_deletion.sql`, `tasks.manage`, evento e auditoria sem hard delete |
| Desempenho | import lazy e Monaco somente no formulario ou card explicitamente expandido |

| Revisao 0.6.8 | Evidencia |
|---|---|
| Lista e cronometro | `Tasks.jsx`, toggle reativo em `TaskDetail.jsx` e contratos em `taskExperience.test.js` |
| Transicao de estado | `setTaskState` preserva 400/404 e converte conflitos conhecidos em JSON 409, com log interno sanitizado |
| Anotacoes GitHub | migration `009_github_code_annotations.sql`, campos estruturados e cards com autor, etapa e data |
| Editor seguro | `@monaco-editor/react`, `monaco-editor`, workers locais e CSP sem origem de CDN |
| Fila de update | controller grava JSON schema 2 atomico, assinado por HMAC, e a UI consulta `/api/health` a cada cinco segundos |

| Revisao 0.6.7 | Evidencia |
|---|---|
| SMTP persistente | migration `008_smtp_settings_and_github_cards.sql`, `smtpSettingsService.js` e rotas Super Admin com CSRF |
| GitHub 1:N | chave propria por registro, rotas POST/PATCH, cards e modal com focus trap |
| Lista priorizada | `ORDER BY CASE`, linhas de 40 px, avatares e campos compactos |
| Cronometro | codigos PostgreSQL conhecidos convertidos em 400/409 pelo `taskTimingService.js` |
| Update pelo painel | POST com MFA e polling de `/api/health` a cada cinco segundos |

| Update transacional | Evidencia |
|---|---|
| Candidate health | `health.sh --candidate` com versao, commit, migration, API, worker e imagens explicitos |
| Promocao atomica | symlink, state schema v3, health instalado interno e health publico em ordem |
| Backup autenticado | manifesto `devflow-backup-v2`, ID da transacao e hashes de backup/snapshot |
| Rollback de banco | restore pre-update obrigatorio antes do health antigo quando migrations mutaram o banco |
| Imagens e worker | tags `candidate-*`/`rollback-*`, IDs anteriores e remocao do worker ausente na topologia antiga |
| Testes | `validate-update-transaction.mjs`, 40 cenarios e fixture 0.5.5 -> 0.6.4 |

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
