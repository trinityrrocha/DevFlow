# Roadmap inicial

## Marco `0.5.3-alpha`

- [x] substituir ACME temporario por Certbot standalone do host;
- [x] validar DNS A por fontes independentes e portas fail-closed;
- [x] montar certificado e Nginx runtime somente leitura;
- [x] preservar containers na falha e recalcular `--resume` por estado real;
- [x] incluir updater com fila privada HMAC e motor unico `update.sh`;
- [x] ativar o symlink operacional antes do updater, com rollback e gate da fila;
- [x] renovar certificado por timer systemd e hook escopado;
- [x] cobrir 30 cenarios de alinhamento e 24 cenarios do ciclo updater/instalacao;
- [ ] homologar instalacao/retomada em VPS AMD64 e ARM64;
- [ ] homologar Certbot, renovacao, backup, restore e rollback reais;
- [ ] executar o Documento 004.

Gates de producao: E2E, acessibilidade, carga, pentest, observabilidade, recuperacao de desastre e aprovacao formal do Documento 004.
