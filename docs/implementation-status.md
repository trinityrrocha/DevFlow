# Estado de implementação

Data de corte: 2026-07-31. Versão: `0.2.0-alpha`.

> O DevFlow está preparado para homologação, não para produção. O Documento 004 ainda não foi executado.

## Implementado na baseline

| Área | Estado atual |
|---|---|
| Identidade | bootstrap único, Argon2id, sessão server-side, cookie protegido, CSRF, troca de senha, MFA TOTP obrigatório e códigos de recuperação |
| Multi-tenant | empresas, memberships, tenant ativo, RBAC e chaves compostas de isolamento |
| Domínio | clientes, projetos, catálogos configuráveis, fluxos e etapas, tarefas como dossiê técnico |
| Evidências | comentários, anexos por referência, testes, aprovações, metadados GitHub, eventos e tempos |
| Governança | histórico imutável, auditoria separada, notificações e snapshots de métricas |
| Banco | PostgreSQL 16, migration `001_initial_schema.sql`, registro real e advisory lock de migration |
| Interface | frontend React/Vite, design system de referência, telas autenticadas e gates de senha/MFA |
| Containers | db, backend, frontend e edge; healthchecks próprios; banco sem porta publicada |
| Instalação | `--check`, `--dry-run` e `--install`; proxy isolado/compartilhado explícito, checkout operacional protegido, releases por SHA e configuração externa |
| Operação | versão instalada/disponível, health diagnóstico, backup criptografado, restore confirmado, timer, updater transacional com manutenção e rollback automático, e desinstalação com preservação padrão |
| Publicação | arquivos de exclusão, contrato `.env.example`, auditoria de repositório e documentação de VPS preparados |

Worker e serviço de fila não existem nesta versão. O processamento disponível permanece no backend e nos mecanismos já documentados.

## Validações locais aplicáveis

A fase executa lint, testes automatizados, build do frontend, carregamento estrutural do backend, parsing e invariantes do Compose, auditoria de dependências, auditoria de arquivos/links/segredos e sintaxe Bash quando as ferramentas estão disponíveis.

Os resultados efetivamente obtidos nesta rodada devem constar no relatório final da publicação; este documento não antecipa sucesso de comandos ainda não executados.

## Pendente para homologação na VPS

- construir imagens e iniciar todos os containers em Linux com Docker;
- executar migration em PostgreSQL real e confirmar `/api/health`;
- ensaiar os dois modos de proxy e a renovação TLS;
- realizar bootstrap, troca de senha e MFA ponta a ponta;
- validar backup e restore com dados descartáveis;
- simular falhas em cada fase do update e comprovar o rollback automático;
- confirmar reboot, timers, permissões e idempotência;
- comprovar coexistência por adaptador persistente aprovado, se houver Full Password.

## Pendente para produção

- Documento 004;
- updater transacional homologado com matriz de falhas, atestação de release e rollback testado;
- CI em toda a matriz Linux/arquitetura;
- testes API, integração, E2E e isolamento de tenant ampliados;
- restore drill periódico e backup remoto 3-2-1;
- acessibilidade, carga, observabilidade, retenção e pentest;
- fixação de imagens por digest e SBOM/assinatura;
- licença do projeto e políticas organizacionais finais.
