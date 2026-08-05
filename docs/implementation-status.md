# Estado de implementacao

Data de corte: 2026-08-05. Versao: `0.5.4-alpha`.

Implementado localmente: Certbot standalone do host, validacao DNS multi-fonte, confirmacoes numericas, certificado e chave validados, Nginx runtime, Compose isolado com updater, retomada por estado material, bootstrap administrativo protegido, renovacao systemd, fila HMAC e atualizacao/rollback pelo motor unico `update.sh`.

Nesta versao, MFA e opcional por padrao e possui politica persistente `optional`/`admins`/`all`, API e controle de Super Admin auditado. O CSRF e vinculado a sessao e centralizado no cliente HTTP. A troca da senha inicial continua obrigatoria e separada do MFA.

O bootstrap publico sem argumentos seleciona `--install`, preserva os modos explicitos, propaga falhas do instalador interno e diferencia conclusao, simulacao, verificacao, retomada e cancelamento.

O ciclo do updater ativa `/opt/devflow/app` antes do estagio 14 com rollback atomico. O daemon publica `daemon.ready`, permanece healthy e suspende a fila enquanto `state/installation-in-progress` existir; a liberacao ocorre somente depois do Super Admin, health final, estado schema v3 e symlink definitivo.

O fechamento do instalador grava o estado atomicamente, valida e recarrega com o codigo instalado e executa o `health.sh --quiet` instalado em novo processo. O reparador de estado atua sem build, migration ou mutacao de banco/certificado/identidade. Esses fluxos foram validados localmente por testes estruturais e fixtures; a execucao operacional real permanece pendente.

O fluxo ACME temporário do DevFlow foi removido e substituído por Certbot standalone.

Nao executado nesta estacao Windows: Docker/Compose real, Certbot/ACME real, systemd real, firewall real, VPS, AMD64/ARM64 real, backup/restore contra PostgreSQL real e rollback induzido real.

O Documento 004 nao foi iniciado. O DevFlow permanece alpha e nao aprovado para producao.
