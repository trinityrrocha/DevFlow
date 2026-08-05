# Estado de implementacao

Data de corte: 2026-08-04. Versao: `0.5.3-alpha`.

Implementado localmente: Certbot standalone do host, validacao DNS multi-fonte, confirmacoes numericas, certificado e chave validados, Nginx runtime, Compose isolado com updater, retomada por estado material, bootstrap administrativo protegido, renovacao systemd, fila HMAC e atualizacao/rollback pelo motor unico `update.sh`.

O bootstrap publico sem argumentos seleciona `--install`, preserva os modos explicitos, propaga falhas do instalador interno e diferencia conclusao, simulacao, verificacao, retomada e cancelamento.

O ciclo do updater ativa `/opt/devflow/app` antes do estagio 14 com rollback atomico. O daemon publica `daemon.ready`, permanece healthy e suspende a fila enquanto `state/installation-in-progress` existir; a liberacao ocorre somente depois do Super Admin, health final, estado schema v3 e symlink definitivo.

O fluxo ACME temporário do DevFlow foi removido e substituído por Certbot standalone.

Nao executado nesta estacao Windows: Docker/Compose real, Certbot/ACME real, systemd real, firewall real, VPS, AMD64/ARM64 real, backup/restore contra PostgreSQL real e rollback induzido real.

O Documento 004 nao foi iniciado. O DevFlow permanece alpha e nao aprovado para producao.
