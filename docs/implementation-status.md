# Estado de implementação

Data de corte: 2026-08-04. Versão: `0.5.0-alpha`.

## Arquitetura vigente

O DevFlow possui somente instalacao isolada. O Compose entrega PostgreSQL, backend, frontend, Nginx e Certbot proprios, redes `devflow_internal`/`devflow_edge`, persistencia em `/opt/devflow`, HTTPS ACME e estado final schema v3.

Foram removidos como caminhos operacionais: providers de Nginx no host, adapter de proxy externo, overlays compartilhados, publicacao posterior, migracao de proxy, escopo interno, reconciliacao compartilhada e reparos especificos de convivencia.

O instalador interativo solicita dominio e um unico e-mail administrativo. Instalacao, resume, update, backup, restore, health, diagnostico e uninstall permanecem fail-closed e limitados aos recursos DevFlow.

`update.sh` continua como motor unico, usado pelo terminal e pelo contrato `update-operation.sh`. O backend expoe apenas `GET /api/operations/update/capabilities`, autenticado e administrativo, para descrever o contrato futuro. Esse endpoint nao executa atualizacoes; `executionAvailable=false`, `UPDATE_API_ENABLED=false` por padrao e nenhuma execucao arbitraria foi exposta ao frontend.

## Validacao pendente

Ainda dependem de VPS Linux: instalacao completa, Docker/Compose reais, DNS/ACME, HTTPS e renovacao, ARM64 real, backup/restauracao, rollback induzido, carga, acessibilidade e pentest.

> O DevFlow esta preparado para homologacao, nao para producao. O Documento 004 ainda nao foi executado.
