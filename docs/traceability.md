# Rastreabilidade — Documento 001

## Instalação isolada `0.5.0-alpha`

| Requisito | Evidencia |
|---|---|
| Modo unico | instalador e estado aceitam somente `isolated` |
| Experiencia | dominio e um e-mail administrativo |
| Portas | preflight fail-closed para 80/443 com proprietario |
| Containers | db, backend, frontend, nginx e certbot proprios |
| Redes | `devflow_internal` interna e `devflow_edge` propria |
| Banco | sem porta no host e fora da rede de borda |
| Proxy | Nginx containerizado com HTTP, HTTPS e seguranca |
| Certificado | ACME webroot, SAN validado e timer de renovacao |
| Persistencia | artefatos sob `/opt/devflow` |
| Transacao | 16 etapas com estado e retomada |
| Update | motor unico `update.sh`, backup e rollback |
| Estado | `installation.json` schema v3 sem campos compartilhados |
| Health | containers, redes, banco, migrations, HTTP, HTTPS e certificado |
| Uninstall | somente recursos DevFlow; sem prune global |
| Desacoplamento | nenhum adapter, provider ou overlay externo operacional |
| Testes | 30 cenarios obrigatorios da arquitetura isolada |

Os registros anteriores permanecem apenas no changelog como historia descontinuada.
