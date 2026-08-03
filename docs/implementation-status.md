# Estado de implementação

Data de corte: 2026-08-03. Versão: `0.4.7-alpha`.

## Provider Nginx do host

Implementados localmente: contrato comum, provider padrão `host-nginx`, providers isolado/legado, estado operacional, virtual host atômico, portas loopback, TLS/Certbot, integração com install/update/health/uninstall e utilitário transacional de migração. Em `0.4.1-alpha`, check/dry-run passaram a provar mappings, porta loopback, Compose original/override, vhost, listeners, saúde e rollback por evidências sanitizadas. A validação local é estrutural/simulada; nenhuma instalação, migração, emissão TLS, reload, troca de portas ou rollback real foi executado nesta rodada.

Em `0.4.3-alpha`, a instalação interna deixou de depender da disponibilidade de 80/443. A primeira instalação interna real chegou à build em Ubuntu 24.04.4 ARM64, mas parou antes dos containers porque `docker compose images -q backend` retornou vazio. Em `0.4.4-alpha`, a fonte de verdade passou a ser o Compose resolvido com confirmação por `docker image inspect`, e a instalação ganhou retomada explícita e estado transacional em 14 etapas. A retomada real ainda aguarda homologação na VPS.

Na tentativa real de `0.4.4-alpha`, dry-run e resume encerraram com código `1` antes do logger: `detect_partial_installation` propagava o falso esperado de `install_transaction_has_stage` como retorno da função sob `set -e`. Em `0.4.5-alpha`, o contrato booleano é explícito, trap/logger antecedem imports, o estado legado pode ser reconstruído e o clone fornecido é auditado como read-only. A validação real desta correção ainda está pendente na VPS.

No dry-run real de `0.4.5-alpha`, o logger confirmou que a renderização Compose falhava antes da resolução de imagens: o comando divergente não aplicava `/opt/devflow/config/devflow.env`, e `DB_PASSWORD` ficou ausente na interpolação. A `0.4.6-alpha` centraliza o comando Compose, separa validação estrutural de runtime, classifica configuração parcial e oferece recuperação somente sem evidência de dados. A imagem nunca foi a causa primária dessa tentativa.

Na retomada real de `0.4.6-alpha`, o PostgreSQL chegou a `healthy`, mas a etapa `09-run-migrations` falhou com `ENOENT`: o `docker compose run` substituiu o `CMD` que definia `MIGRATIONS_DIR`, levando o Node a procurar `/app/database/migrations` enquanto a imagem continha `/database/migrations`. A `0.4.7-alpha` torna esse ambiente permanente, valida os arquivos dentro da imagem, centraliza o comando e preserva banco/frontend comprovados ao retomar da etapa 09. Essa correção ainda não foi executada na VPS.

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
| Containers | db, backend, frontend e edge; healthchecks próprios; `devflow_edge` separada de `devflow_internal`; banco sem porta publicada |
| Instalação | bootstrap público independente; proxy explícito; diagnóstico compartilhado read-only; adaptador estrito para o contrato comprovado do `fullpassword_nginx`; outros Nginx containerizados/Caddy bloqueados; checkout HTTPS protegido e releases por SHA |
| Operação | versão instalada/disponível, health diagnóstico, backup criptografado, restore confirmado, timer, updater transacional com manutenção e rollback automático, e desinstalação com preservação padrão |
| Publicação | repositório público, contrato `.env.example`, auditorias do checkout e de todo o histórico Git, documentação de VPS e ausência explícita de licença |

Worker e serviço de fila não existem nesta versão. O processamento disponível permanece no backend e nos mecanismos já documentados.

## Evidência real de VPS

Na VPS Ubuntu 24.04 ARM64, `--check` do commit `be1636861505d4f8bedbd42e84d3d66eb70f6fad`, versão `0.3.2-alpha`, concluiu com `passed-with-privileged-dry-run-required`. O dry-run comum não chegou ao gate: `discover_fullpassword_compose_inputs` referenciava `FULLPASSWORD_COMPOSE_FILE` sem inicialização sob `set -u`. Nenhuma alteração foi realizada. A versão `0.3.3-alpha` introduz descoberta defensiva e o teste de regressão; ainda não foi executada nessa VPS. O modo compartilhado continua não homologado.

## Validações locais aplicáveis

A fase executa lint, testes automatizados, build do frontend, carregamento estrutural do backend, parsing e invariantes do Compose, auditoria de dependências, auditoria de arquivos/links/segredos, auditoria de todos os commits alcançáveis e sintaxe Bash quando as ferramentas estão disponíveis.

Os resultados efetivamente obtidos nesta rodada devem constar no relatório final da publicação; este documento não antecipa sucesso de comandos ainda não executados.

## Pendente para homologação na VPS

- construir imagens e iniciar todos os containers em Linux com Docker;
- executar o bootstrap público em diretório vazio usando `wget` e `curl` em Linux;
- executar migration em PostgreSQL real e confirmar `/api/health`;
- executar dry-run e `--resume` com `0.4.7-alpha`, confirmar `resume_from_stage=09-run-migrations`, diretório `/database/migrations` e arquivar os relatórios sanitizados;
- confirmar migration, bootstrap do Super Admin, health interno e estado transacional final na VPS ARM64;
- confirmar na VPS todos os booleans do Compose, Nginx, loopback, health e rollback antes de considerar `migration_ready=true`;
- confirmar `compose_cross_directory_supported=true`, `compose_merge_valid=true`, `changes_performed=false` e `installation_ready=true` no dry-run privilegiado;
- executar posteriormente a migração controlada e confirmar Nginx do host, Full Password e rollback;
- ensaiar instalação completa com Nginx do host compatível e o modo isolado, incluindo renovação TLS;
- realizar bootstrap, troca de senha e MFA ponta a ponta;
- validar backup e restore com dados descartáveis;
- simular falhas em cada fase do update e comprovar o rollback automático;
- confirmar reboot, timers, permissões e idempotência;
- ensaiar o adaptador persistente com Docker/Nginx reais, ACME, recriação exclusiva do proxy, falhas induzidas e rollback dos dois domínios.

## Pendente para produção

- Documento 004;
- updater transacional homologado com matriz de falhas, atestação de release e rollback testado;
- CI em toda a matriz Linux/arquitetura;
- testes API, integração, E2E e isolamento de tenant ampliados;
- restore drill periódico e backup remoto 3-2-1;
- acessibilidade, carga, observabilidade, retenção e pentest;
- fixação de imagens por digest e SBOM/assinatura;
- licença do projeto e políticas organizacionais finais.
