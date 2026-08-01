# Rastreabilidade — Documento 001

| Requisito | Evidência |
|---|---|
| Clonar Full Password | Cópia local isolada, fora do repositório DevFlow |
| Somente leitura | Git limpo antes e depois da análise |
| Identificar commit | `804008b5df5d0931ec5d95227fed44086f430d76` |
| Estrutura e camadas | `architecture/fullpassword-analysis.md`, seções 2 e 3 |
| Segurança | `architecture/fullpassword-analysis.md`, seção 4 |
| Docker/Compose/Nginx/HTTPS | `architecture/fullpassword-analysis.md`, seção 5 |
| WebUpdater | `architecture/fullpassword-analysis.md`, seção 6 |
| Backup/restauração | `architecture/fullpassword-analysis.md`, seção 7 |
| Interface | `architecture/fullpassword-analysis.md`, seção 8 |
| Arquitetura DevFlow | `architecture/devflow-architecture.md` |
| Servidor limpo | `infrastructure/installation.md`, seção 3 |
| Infraestrutura existente | `infrastructure/installation.md`, seção 4 |
| Coexistência | `infrastructure/infrastructure.md` e `installation.md` |
| Não interromper aplicações | probes e fail-closed em `installation.md` |
| README completo | `/README.md` |
| Documentação de infraestrutura | `infrastructure/` |
| Documentação de instalação | `infrastructure/installation.md` |
| Padrões de desenvolvimento | `development/standards.md` |
| Roadmap | `roadmap.md` |
| Estrutura base | diretórios backend, frontend, database, docker, scripts e tests |
| Gate documental inicial | documentação concluída antes da baseline funcional, conforme histórico de implementação |
| Publicação GitHub | destino exclusivo `trinityrrocha/DevFlow`, público e branch `main`, após auditoria histórica |

## Fase 3.5

| Requisito | Evidência |
|---|---|
| Instalador fail-closed | `../scripts/install.sh` e launcher `../install.sh` |
| Diagnóstico sanitizado | `../scripts/diagnose.sh` |
| Atualização transacional | `../scripts/update.sh`, `../scripts/version.sh`, `../scripts/health.sh` e `infrastructure/update-backup-rollback.md` |
| Desinstalação segura | `../scripts/uninstall.sh` |
| Configuração sem segredos | `../.env.example`, `.gitignore` e `.dockerignore` |
| Healthchecks | `../docker-compose.yml`, backend `/api/health` e frontend `/healthz` |
| VPS limpa e existente | `infrastructure/vps-installation.md` |
| Coexistência não destrutiva | `infrastructure/installation.md` |
| Primeiro deployment | `operations/first-deployment.md` |
| Troubleshooting | `operations/troubleshooting.md` |
| Verificação pré-publicação | `../scripts/repository-audit.mjs` |
| Auditoria de todo o histórico | `../scripts/history-audit.mjs` |
| Bootstrap público | `../scripts/bootstrap.sh` |
| Estado alpha | `implementation-status.md` e README |
| Documento 004 não iniciado | `implementation-status.md` e roadmap |
| Diagnóstico de proxy compartilhado | `../scripts/detect-shared-proxy.sh` e `/var/log/devflow/shared-proxy-diagnostic.log` |
| Redes separadas | `../docker-compose.yml`: `devflow_edge` e `devflow_internal` |
| Configuração Nginx transacional | `../scripts/lib/proxy-config.sh` |
| Testes do modo compartilhado | `../tests/integration/shared-proxy.test.sh` e `../scripts/validate-shared-proxy.mjs` |

## Correção do instalador compartilhado

| Requisito | Evidência |
|---|---|
| Ensaio real registrado | commit `4d350685cbc9d21b49fb4c01176b846ca66d6584` em `implementation-status.md` |
| Detecção read-only | inspect, `nginx -T`, `nginx -t` e network inspect em `../scripts/detect-shared-proxy.sh` |
| Full Password preservado | política `fullpassword-nginx` retorna bloqueio antes do plano de instalação |
| Caddy não anunciado | política explícita `caddy-host`/`caddy-container` bloqueada |
| Relatório sanitizado | `/var/log/devflow/shared-proxy-diagnostic.log`, modo `0600` |
| Aplicação atômica | arquivo exclusivo, backup, validação, reload e rollback em `../scripts/lib/proxy-config.sh` |
| Remoção reversível | `remove_host_nginx_config` remove somente a rota com marcador DevFlow |
| Dados isolados | banco somente em `devflow_internal`; borda separada em `devflow_edge` |

## Mecanismo de atualização 0.2.0-alpha

| Requisito | Evidência |
|---|---|
| Desenvolvimento somente no Windows | checkout da VPS documentado como operacional, sem commits, em `infrastructure/update-backup-rollback.md` |
| Origem GitHub e branch | remote exato `trinityrrocha/DevFlow`, `main`, fast-forward e checkout limpo em `../scripts/update.sh` |
| Versão instalada/disponível | `../VERSION`, `../CHANGELOG.md` e `../scripts/version.sh` |
| Confirmação e changelog | gate literal e extração da versão em `../scripts/update.sh` |
| Backup validado antes da mutação | `../scripts/backup.sh`, `../scripts/verify-backup.sh` e gate no updater |
| Manutenção isolada/compartilhada | `../docker-compose.maintenance.yml` e templates em `../docker/nginx/` |
| Migrations coordenadas | backend/frontend parados, advisory lock e confirmação no PostgreSQL |
| Health checks | `../scripts/health.sh`, probes internos e públicos |
| Rollback automático | restauração de dados, código, containers, proxy e timers em `../scripts/update.sh` |
| Log e relatório | `/opt/devflow/logs/update-*.log` e `/opt/devflow/data/update-report.txt` |
| Instalador sem update | validação estrutural em `../scripts/validate-operations.mjs` |

## Publicação pública

| Requisito | Evidência |
|---|---|
| Download sem pipe remoto | comando `wget`, revisão local e execução separada no README |
| Independência de clone prévio | `../scripts/bootstrap.sh` é standalone e cria checkout temporário |
| Origem e commit comprovados | remote HTTPS exato, `main`, `ls-remote`, `fsck` e `VERSION` no bootstrap |
| Atualização anônima | remote operacional HTTPS público validado em `../scripts/update.sh` |
| Sem segredos atuais | `../scripts/repository-audit.mjs` |
| Sem segredos históricos | `../scripts/history-audit.mjs` |
| Metadados instalados | `/opt/devflow/data/install-report.txt` registra versão, commit, ref, URL, data e canal |
| Licença | ausência declarada no README; direitos autorais padrão, sem licença escolhida automaticamente |

## Documento 002

| Requisito | Evidência planejada |
|---|---|
| Dashboard geral e por desenvolvedor | API de métricas e página Dashboard |
| Solicitação e Bug | domínio `tasks` com tipos distintos |
| Workflow obrigatório | serviço de transição e requisitos por etapa |
| Administração | endpoints auditados de prioridade, responsáveis e estado |
| Abas do card | detalhe de tarefa no frontend |
| Testes | registros append-only por contexto |
| GitHub | metadados de repositório, branch, commit, PR e release |
| Anexos | storage isolado, checksum e metadados |
| Comentários | timeline cronológica append-only |
| Histórico | eventos e auditoria imutáveis |
| Cronômetros | intervalos persistidos por etapa |
| Notificações | interna e SMTP configurável |
| Usuários e perfis extensíveis | níveis + tabela de perfis técnicos |
| Qualidade/produtividade | fórmulas versionadas no Documento 002 |

## Documento 003

| Requisito | Evidência |
|---|---|
| Multi-tenant preparado desde a origem | `companies`, `company_memberships`, sessão com empresa ativa e FKs compostas |
| Usuários, papéis, permissões e perfis | RBAC por empresa e perfis técnicos extensíveis |
| Clientes e projetos independentes | tabelas, API e tela de Cadastros |
| Ambientes, prioridades e tipos configuráveis | catálogos por tenant sem enums de domínio |
| Fluxos configuráveis | `workflows`, `workflow_stages`, ordem, responsabilidade e requisitos JSON |
| Tarefa como dossiê técnico | detalhe agrega entregas, testes, aprovações, GitHub, anexos, comentários, eventos, tempos e bugs relacionados |
| Histórico permanente | triggers imutáveis para eventos, comentários, testes e aprovações |
| Auditoria separada | `audit_events` e API administrativa segregada do histórico da tarefa |
| Storage por referência | `storage_key`, checksum e prefixo por tenant; conteúdo em volume privado |
| Métricas sem cálculo em leitura | snapshots de empresa e desenvolvedor atualizados em segundo plano |
| Modelo relacional | `architecture/data-model.md` |

## Observações de conformidade

- O atualizador do Full Password não possui backup pré-update ou rollback automático. A documentação registra a diferença entre comportamento real e desejado.
- O instalador do Full Password assume servidor exclusivo. O DevFlow proíbe replicar ações globais destrutivas.
- A coexistência automática com o Nginx containerizado atual depende de um ponto de extensão persistente. Sem ele, a instalação falha de forma segura e não modifica o Full Password.
