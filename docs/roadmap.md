# Roadmap inicial

## Marco `0.4.0-alpha` — provider Nginx no host

- [x] contrato e três providers;
- [x] estado operacional e integração nos scripts;
- [x] loopback, virtual host, Certbot e rollback de configuração;
- [x] utilitário separado de migração com check/dry-run;
- [ ] homologar provider em VPS;
- [ ] executar migração em janela aprovada e validar rollback real;
- [ ] somente depois avaliar remoção do adaptador legado.

## Fase 0 — Fundação documental

Estado: concluída nesta entrega.

- análise Full Password;
- arquitetura DevFlow;
- segurança;
- infraestrutura e coexistência;
- update, backup e rollback;
- sistema visual;
- padrões e estrutura base.

## Fase 1 — Descoberta de domínio

Estado: concluída pelos Documentos 002 e 003.

- objetivo e personas do DevFlow;
- jornadas principais;
- entidades e estados;
- matriz de permissões;
- classificação de dados;
- threat model;
- protótipos.
- modelo multi-tenant;
- clientes, projetos e catálogos configuráveis;
- fluxos declarativos e dossiê técnico imutável;
- snapshots de métricas.

Saída: [especificação funcional](functional/document-002.md) e [modelo de dados](functional/document-003.md).

## Fase 2 — Fundação executável

Estado: concluída na baseline funcional.

- manifests com lockfiles;
- backend mínimo com config validada e healthchecks;
- frontend shell e design tokens;
- PostgreSQL e mecanismo de migrations;
- Compose de desenvolvimento;
- pipeline de qualidade;
- autenticação, sessão, CSRF e auditoria;
- testes de segurança.

Saída: plataforma autenticada sem módulos de negócio.

## Fase 3 — Instalador e coexistência

Estado: implementação inicial concluída; laboratório pendente.

- engine detect/plan/apply/rollback;
- modo servidor limpo;
- adaptador host Nginx;
- adaptador ingress persistente;
- certificados;
- relatório de instalação;
- laboratório com Full Password;
- reboot e idempotência.

Saída: instalação segura nos cenários suportados.

## Fase 3.5 — Publicação inicial e homologação

Estado: baseline publicada e mecanismo de update implementado localmente; ensaios na VPS dependem dos gates registrados.

- versão `0.3.3-alpha` consistente;
- instalador inicial seguro com check, dry-run e install;
- bootstrap público independente do checkout e atualizações anônimas por HTTPS;
- updater separado com consulta de versão/changelog, manutenção e rollback automático;
- diagnóstico sanitizado;
- adaptador persistente e reversível para o contrato comprovado do `fullpassword_nginx`;
- backup, restore e desinstalação preservando dados por padrão;
- documentação operacional e de VPS;
- auditoria de arquivos, links, caminhos e segredos;
- repositório inicialmente privado e posteriormente aberto em `trinityrrocha/DevFlow` após auditoria histórica;
- primeiro commit direto na `main`, sem tag, release, PR ou force push;
- ensaio em VPS de homologação.

Saída: baseline clonável e instalável para homologação, ainda não aprovada para produção. O Documento 004 permanece fora desta fase.

## Fase 4 — Backup e operador

Estado: backup/restore e updater transacional executáveis; laboratório de falhas e hardening pendentes.

- formato DevFlow;
- backup local; backup remoto pendente;
- verificação e restore;
- updater por release imutável;
- backup pré-update;
- manutenção e rollback automático; canário pendente;
- runbooks de desastre.

Saída: operação recuperável.

## Fase 5 — Primeiro módulo de negócio

Estado: baseline dos Documentos 002 e 003 implementada; integração e E2E pendentes.

Somente após as fases anteriores:

- API e modelo do módulo;
- UI responsiva;
- permissões;
- auditoria;
- exclusão recuperável;
- backup/restore;
- testes E2E.

O conteúdo funcional e estrutural está definido nos Documentos 002 e 003.

## Fase 6 — Hardening e produção

- pentest;
- análise de dependências e imagens;
- carga e limites;
- observabilidade;
- retenção;
- acessibilidade;
- documentação operacional;
- restore drill;
- piloto controlado.

## Critérios de passagem

Cada fase exige:

- critérios de aceite aprovados;
- testes verdes;
- riscos documentados;
- rollback praticado quando operacional;
- nenhuma regressão no Full Password coexistente.
