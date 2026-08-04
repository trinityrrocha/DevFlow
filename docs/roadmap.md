# Roadmap inicial

## Marco `0.4.10-alpha` — reconciliação transacional da release instalada

- [x] separar reconciliação de imagens do update e do reparo somente de metadados;
- [x] construir backend/frontend exclusivamente a partir do checkout canônico instalado;
- [x] preservar PostgreSQL, migration, proxy, Full Password e imagens anteriores;
- [x] promover labels OCI, configuração e estado com rollback automático;
- [x] classificar API legada sem commit e bloquear publicação concorrente;
- [ ] executar check, reconciliação e falha induzida na VPS ARM64.

## Marco `0.4.9-alpha` — identidade instalada e estado versionado

- [x] centralizar versão, commit, ref e repositório no checkout canônico;
- [x] criar schema camelCase `schemaVersion: 1` com promoção atômica;
- [x] criar reparador idempotente com backup protegido;
- [x] reconciliar configuração, labels OCI e API sem reiniciar serviços;
- [x] bloquear update e publicação quando o estado estiver inconsistente;
- [ ] executar o reparo real e o dry-run de publicação na VPS ARM64.

## Marco `0.4.8-alpha` — validação direta das imagens

- [x] remover a dependência de Compose e redes da inspeção do backend;
- [x] executar a validação com `docker run --network none` sobre a imagem resolvida;
- [x] distinguir conteúdo ausente de erro do runtime Docker;
- [x] persistir `rootCause` e o próximo estágio transacional;
- [x] cobrir os dois modos e os três providers em 24 cenários;
- [ ] retomar a instalação real a partir de `06-validate-images` na VPS ARM64.

## Marco `0.4.7-alpha` — migrations e confirmações numéricas

- [x] tornar `/database/migrations` permanente na imagem e no Compose;
- [x] centralizar execução e validação das migrations;
- [x] preservar PostgreSQL saudável e frontend comprovado ao retomar da etapa 09;
- [x] substituir confirmações textuais por menus numéricos fail-closed;
- [x] cobrir migrations em 20 cenários e menus em 16 cenários;
- [ ] executar dry-run, resume, migration e health na VPS Ubuntu 24.04 ARM64.

## Marco `0.4.6-alpha` — env privado e Compose centralizado

- [x] centralizar todas as operações Compose do DevFlow com `--env-file` explícito;
- [x] separar validação estrutural com placeholders da validação runtime;
- [x] interromper a resolução de imagens quando a renderização falhar;
- [x] classificar e recuperar configuração parcial somente quando não existirem dados;
- [x] cobrir env-file, sanitização e fail-closed em 24 cenários;
- [ ] repetir dry-run e resume na VPS Ubuntu 24.04 ARM64 com Compose 5.3.1.

## Marco `0.4.5-alpha` — inicialização observável e retomada legada

- [x] instalar trap e logger sanitizados antes dos imports;
- [x] impedir falso booleano de encerrar o chamador sob `set -e`;
- [x] reconstruir em memória o estado legado e persistir somente após confirmação;
- [x] preservar e comprovar o clone de origem como read-only;
- [x] cobrir startup e retomada com 26 cenários automatizados;
- [ ] repetir diagnóstico, dry-run e resume na VPS ARM64.

## Marco `0.4.4-alpha` — imagens determinísticas e retomada segura

- [x] resolver imagens pelo Compose e confirmar existência com `docker image inspect`;
- [x] normalizar referências locais e Docker Hub sem conflar registries;
- [x] persistir 14 etapas de instalação em estado transacional atômico;
- [x] oferecer retomada explícita, preservando imagens e dados válidos;
- [x] cobrir a regressão em 24 cenários automatizados;
- [ ] retomar a instalação real e validar health na VPS ARM64.

## Marco `0.4.3-alpha` — instalação interna independente

- [x] separar instalação interna e publicação HTTPS;
- [x] comprovar proprietário de 80/443 cruzando Docker e sockets;
- [x] manter frontend e backend somente em loopback;
- [x] registrar estado e health por escopo;
- [ ] homologar check, dry-run e instalação interna na VPS ARM64.

## Marco `0.4.2-alpha` — versão pública dinâmica

- [x] remover pin operacional do bootstrap em `main`;
- [x] centralizar SemVer e consistência de componentes;
- [x] suportar tag e versão esperada somente quando explícitas;
- [x] adicionar regressões contra futuros incrementos sem edição manual do bootstrap;
- [ ] repetir `--check` e `--dry-run` na VPS antes de nova tentativa de instalação.

## Marco `0.4.1-alpha` — evidências da migração para Nginx no host

- [x] contrato e três providers;
- [x] estado operacional e integração nos scripts;
- [x] loopback, virtual host, Certbot e rollback de configuração;
- [x] check/dry-run com gates técnicos, relatório sanitizado e 21 regressões;
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

- versão `0.4.10-alpha` consistente;
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
