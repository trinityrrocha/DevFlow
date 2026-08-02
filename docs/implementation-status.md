# Estado de implementação

Data de corte: 2026-08-02. Versão: `0.3.1-alpha`.

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

O bootstrap público do commit `4d350685cbc9d21b49fb4c01176b846ca66d6584`, versão `0.2.0-alpha`, foi executado em uma VPS de homologação no modo compartilhado. A detecção de `fullpassword_nginx` interrompeu a instalação antes de integração insegura e produziu o inventário aprovado. A versão `0.3.1-alpha` corrige a localização do override para manter `/opt/fullpassword` estritamente read-only, mas ainda não foi executada nessa VPS. O modo compartilhado continua não homologado.

## Validações locais aplicáveis

A fase executa lint, testes automatizados, build do frontend, carregamento estrutural do backend, parsing e invariantes do Compose, auditoria de dependências, auditoria de arquivos/links/segredos, auditoria de todos os commits alcançáveis e sintaxe Bash quando as ferramentas estão disponíveis.

Os resultados efetivamente obtidos nesta rodada devem constar no relatório final da publicação; este documento não antecipa sucesso de comandos ainda não executados.

## Pendente para homologação na VPS

- construir imagens e iniciar todos os containers em Linux com Docker;
- executar o bootstrap público em diretório vazio usando `wget` e `curl` em Linux;
- executar migration em PostgreSQL real e confirmar `/api/health`;
- executar `--check` e `--dry-run` com `0.3.1-alpha` e confirmar os fatos de merge entre diretórios;
- executar o modo compartilhado com `0.3.1-alpha` e confirmar o diagnóstico `compatible-with-compose-override`;
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
