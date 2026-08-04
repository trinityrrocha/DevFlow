# Roadmap inicial

## Marco `0.5.0-alpha` — instalação isolada definitiva

- [x] remover arquitetura compartilhada e providers;
- [x] adotar Compose unico com proxy e certificados proprios;
- [x] simplificar instalador para dominio e e-mail administrativo;
- [x] bloquear portas 80/443 ocupadas sem adaptacao automatica;
- [x] implementar ACME HTTP seguido de promocao HTTPS;
- [x] adotar `installation.json` schema v3 isolado;
- [x] manter `update.sh` como motor unico com backup e rollback;
- [x] alinhar health, diagnostico e uninstall ao namespace DevFlow;
- [ ] executar homologacao privilegiada completa na VPS Linux;
- [ ] implementar a interface administrativa de update sobre o contrato allowlisted;
- [ ] executar Documento 004.

## Gates antes de producao

- instalacao e retomada reais em AMD64 e ARM64;
- emissao e renovacao real de certificado;
- backup, restauracao e rollback induzido;
- E2E, acessibilidade e carga;
- revisao de seguranca e pentest;
- aprovacao formal do Documento 004.
