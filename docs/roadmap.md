# Roadmap inicial

## Marco `0.6.27-alpha`

- homologar a gestao administrativa de backups e o WebUpdater sem backup pre-update;
- validar restore com backup de seguranca na VPS;
- confirmar rollback operacional sem afirmacao de restore de dados.

## Marco `0.6.25-alpha`

- homologar alternancia e persistencia dos temas claro/escuro na VPS;
- usar a mudanca visual observavel para validar o WebUpdater corrigido na revisao anterior;
- revisar contraste das telas autenticadas com dados reais.

## Marco `0.6.24-alpha`

- homologar na VPS o health de runtime do WebUpdater pela rede `devflow_edge`;
- confirmar HTTP 301/308 e HTTPS estrito pelo Nginx a partir do updater;
- preservar o health do host como gate estrito de certificados e timers.

## Marco `0.6.23-alpha`

- inserir aprovação gerencial do Frontend antes da atualização no GitHub;
- preservar motivo, comentário e evidência nas devoluções para Frontend;
- simplificar os perfis de QA e ampliar as timelines de testes e anexos;
- homologar migration e transições na VPS.

## Marco `0.6.22-alpha`

- unificar o contrato absoluto e persistente da fila entre backend e updater;
- registrar no backend o destino final do pedido enfileirado;
- homologar na VPS a criação, consumo e rastreamento do JSON pelo volume compartilhado.

## Marco `0.6.21-alpha`

- refinar modal e timeline de QA;
- padronizar cards compactos da timeline de anexos;
- exibir checklist de evidências e bloqueios antes do avanço de etapa;
- homologar a experiência em navegador autenticado na VPS.

## Marco `0.6.20-alpha`

- reconciliar pela migration 013 ambientes que ja registraram uma versao anterior da 012;
- homologar a sequencia 012/013 em PostgreSQL real na VPS.

## Marco `0.6.19-alpha`

- eliminar o `P0001` da migration 012 e preservar o CRUD auditado de QA;
- homologar a migration em PostgreSQL real durante a atualizacao transacional da VPS.

## Marco `0.6.18-alpha`

- fila web do updater em bind persistente compartilhado e auditavel no host;
- polling em duas fases com recuperacao automatica pelo health check;
- homologar na VPS o primeiro update externo de reconciliacao e o update web subsequente.

## Marco `0.6.17-alpha`

- modulo estruturado de QA com cards, modal, anexos por teste e exclusao logica;
- rastreabilidade da origem dos anexos e timeline vertical no dossie tecnico;
- preservar a arquitetura isolada e homologar migration/UI em VPS antes de producao.

- [x] concluir Fase 1: navegacao superior, Clientes, Projetos e configuracoes segmentadas;
- [x] preservar URLs antigas com redirecionamentos;
- [x] aplicar permissoes de Clientes e Projetos no backend;
- [x] concluir Fase 2: usuarios, perfis e sessoes;
- [x] concluir Fase 3: Roadmap e tempos;
- [x] concluir Fase 4: e-mail, recuperacao, notificacoes e outbox;
- [x] implementar configuracao SMTP cifrada e teste direto no painel;
- [x] implementar registros GitHub 1:N e lista de tarefas compacta/priorizada;
- [x] restringir update do painel ao Super Admin com CSRF, sem exigir MFA, e acompanhar retorno pelo health;
- [ ] homologar migration 008, SMTP, entrega, retry e worker na VPS;

- [x] substituir ACME temporario por Certbot standalone do host;
- [x] validar DNS A por fontes independentes e portas fail-closed;
- [x] montar certificado e Nginx runtime somente leitura;
- [x] preservar containers na falha e recalcular `--resume` por estado real;
- [x] incluir updater com fila privada HMAC e motor unico `update.sh`;
- [x] separar health candidato da identidade instalada e tornar promocao/rollback transacionais;
- [x] ativar o symlink operacional antes do updater, com rollback e gate da fila;
- [x] renovar certificado por timer systemd e hook escopado;
- [x] ampliar o heap do build Docker do frontend e isolar o chunk Monaco;
- [x] tornar o Monaco editavel nao controlado e corrigir foco/sizing no modal GitHub;
- [x] separar lead time e touch time por etapa, sem metricas no Roadmap;
- [x] encerrar tempos automaticamente na transicao e remover conclusao manual;
- [x] apresentar previews nativos de imagens e videos anexados;
- [x] tornar o polling de update resiliente ao retorno da API apos 502/503;
- [x] corrigir a tipagem SQL, autoria, concorrencia e respostas semanticas da rota de timer;
- [x] rastrear pedidos de update nos quatro diretorios e tolerar reinicio no polling web;
- [x] cobrir 30 cenarios de alinhamento e 24 cenarios do ciclo updater/instalacao;
- [ ] homologar instalacao/retomada em VPS AMD64 e ARM64;
- [ ] homologar Certbot, renovacao, backup, restore e rollback reais;
- [ ] executar o Documento 004.

Gates de producao: E2E, acessibilidade, carga, pentest, observabilidade, recuperacao de desastre e aprovacao formal do Documento 004.
