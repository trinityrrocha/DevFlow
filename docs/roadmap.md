# Roadmap inicial

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
