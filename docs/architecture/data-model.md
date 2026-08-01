# Modelo relacional do DevFlow

Este documento materializa o [Documento 003](../functional/document-003.md).

```mermaid
erDiagram
    COMPANIES ||--o{ COMPANY_MEMBERSHIPS : possui
    USERS ||--o{ COMPANY_MEMBERSHIPS : participa
    COMPANY_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : recebe
    COMPANY_ROLES ||--o{ MEMBERSHIP_ROLES : concede
    COMPANY_ROLES ||--o{ ROLE_PERMISSIONS : agrega
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : autoriza
    COMPANY_MEMBERSHIPS ||--o{ MEMBERSHIP_TECHNICAL_PROFILES : possui
    TECHNICAL_PROFILES ||--o{ MEMBERSHIP_TECHNICAL_PROFILES : classifica

    COMPANIES ||--o{ CLIENTS : possui
    CLIENTS ||--o{ PROJECTS : possui
    ENVIRONMENTS ||--o{ PROJECTS : padrao
    PROJECTS ||--o{ PROJECT_RESPONSIBLES : possui
    COMPANY_MEMBERSHIPS ||--o{ PROJECT_RESPONSIBLES : assume

    COMPANIES ||--o{ PRIORITIES : configura
    COMPANIES ||--o{ TASK_TYPES : configura
    COMPANIES ||--o{ ENVIRONMENTS : configura
    COMPANIES ||--o{ WORKFLOWS : configura
    WORKFLOWS ||--o{ WORKFLOW_STAGES : ordena

    PROJECTS ||--o{ TASKS : organiza
    CLIENTS ||--o{ TASKS : demanda
    PRIORITIES ||--o{ TASKS : prioriza
    TASK_TYPES ||--o{ TASKS : tipifica
    ENVIRONMENTS ||--o{ TASKS : executa_em
    WORKFLOWS ||--o{ TASKS : governa
    WORKFLOW_STAGES ||--o{ TASKS : etapa_atual

    TASKS ||--o{ TASK_EVENTS : historico
    TASKS ||--o{ TASK_COMMENTS : conversa
    TASKS ||--o{ TASK_ATTACHMENTS : referencia
    TASKS ||--o{ TASK_TESTS : valida
    TASKS ||--o{ TASK_APPROVALS : aprova
    TASKS ||--o| TASK_GITHUB_METADATA : publica
    TASKS ||--o{ TASK_STAGE_INTERVALS : mede

    COMPANIES ||--o| COMPANY_METRIC_SNAPSHOTS : resume
    COMPANY_MEMBERSHIPS ||--o{ DEVELOPER_METRIC_SNAPSHOTS : mede
```

## Regras físicas

- UUID para entidades públicas;
- `TIMESTAMPTZ` para datas;
- `company_id` em todas as entidades de domínio;
- FKs compostas para isolamento;
- índices iniciados por `company_id`;
- `ON DELETE RESTRICT` para dossiês e catálogos referenciados;
- exclusão lógica com `deleted_at` ou arquivamento com `is_active`;
- triggers append-only para eventos, comentários, testes, aprovações e auditoria;
- `JSONB` somente para requisitos declarativos, snapshots e valores de auditoria, não
  para substituir relações centrais.

## Estratégia de evolução

Como ainda não há instalação produtiva homologada, a migration inicial pode incorporar
o modelo completo. Depois da primeira release estável, qualquer mudança será adicionada
em uma nova migration forward-only; migrations já aplicadas não serão reescritas.
