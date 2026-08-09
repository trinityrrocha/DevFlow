# Estado de implementacao

Data de corte: 2026-08-09. Versao: `0.6.11-alpha`.

Revisao 0.6.11 implementada localmente: o estagio Docker do frontend recebe `NODE_OPTIONS=--max-old-space-size=4096` imediatamente antes do build e o Rollup isola `monaco-editor` e `@monaco-editor` em chunk dedicado. A mudanca corrige a causa identificada do rollback de `0.6.10-alpha`. O build local foi validado; Docker e VPS reais dependem de nova homologacao.

Revisao 0.6.10 implementada localmente: pedido de atualizacao restrito ao Super Admin com sessao valida e CSRF, sem gate de MFA inclusive quando a politica global exige configuracao; toggle unico do cronometro com spinner e bloqueio concorrente, sem cancelamento na API de tempo; controller de estado com respostas JSON 400/404/409 e falha interna 500 sanitizada. A base Monaco e as migrations 009/010 foram verificadas sem reescrita. Navegador autenticado, PostgreSQL, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.9 implementada localmente: Monaco reutilizavel com configuracao segura, Pascal/Delphi e PowerShell, deteccao automatica reversivel sem sobrescrever escolha manual, tema observado no documento, previews expansivos sob demanda, validacao de codigo obrigatorio e limite UTF-8 de 200 KB. A migration 010 acrescenta exclusao logica auditavel aos cards sem alterar as migrations 008/009 publicadas. PostgreSQL, Docker, console do navegador e VPS reais ainda dependem de homologacao.

Revisao 0.6.8 implementada localmente: lista de tarefas sem subtitulo redundante e com cabecalho de maior contraste; controle unico e reativo do cronometro; erros de transicao conhecidos em JSON 400/404/409; anotacoes GitHub estruturadas com arquivo, linguagem, codigo, explicacao, autor e etapa; Monaco Editor e workers empacotados localmente; pedido fisico do updater gravado atomicamente na fila HMAC e monitoramento de indisponibilidade/retorno pelo health. A migration 009, o updater em container e os fluxos contra PostgreSQL/Docker/VPS reais ainda dependem de homologacao.

Revisao 0.6.7 implementada localmente: SMTP persistente cifrado e teste direto, lista compacta e ordenada, erros conhecidos do cronometro em 400/409, registros GitHub 1:N e solicitacao de update com MFA e polling do health. A migration 008 e a operacao em PostgreSQL/Docker/VPS ainda dependem de homologacao.

Fase 4 concluida localmente: notificacoes internas paginadas, preferencias, eventos de etapa/atribuicao/atraso/conclusao, recuperacao de senha e outbox transacional cifrada. O worker usa claim concorrente, idempotencia, retry/backoff e auditoria sem conteudo sensivel. SMTP, entrega real, PostgreSQL em container e operacao do worker na VPS permanecem pendentes de homologacao manual.

Fase 3 concluida localmente: tarefas em Roadmap sao visiveis somente ao criador, Admin e Super Admin; fora dele, somente participantes, responsaveis de projeto e administradores. O gate cobre lista/busca/detalhe/relacionados/anexos/comentarios/testes/notificacoes/dashboard. Estimativa em segundos, estados explicitos de timer, acumulado persistido, timestamps, atraso, filtro, UI e historico foram implementados. Concorrencia e reinicio foram validados por contrato e calculos unitarios; PostgreSQL/VPS real permanece pendente.

Fase 2 concluida localmente: telefone E.164 opcional, e-mail proprio pendente ate confirmacao com token aleatorio armazenado por hash, administracao de nome/e-mail/telefone/papel/perfis/status, redefinicao de senha temporaria, remocao auditada de MFA, revogacao de sessoes e painel de auditoria de sessoes. SMTP real e entrega do e-mail de confirmacao dependem de homologacao manual.

Fase 1 concluida localmente: navegacao superior responsiva sem menu lateral, dropdowns com ARIA/teclado/Escape, rotas canonicas com compatibilidade, paginas independentes de Clientes e Projetos, autorizacao backend separada para leitura/gestao e Nova Tarefa restrita a `/task`. CRUD, filtros, paginacao, associacao de equipe e bloqueio de exclusao com vinculos foram cobertos por validacoes locais e simuladas. Homologacao visual em navegador e VPS permanece pendente.

Implementado localmente: Certbot standalone do host, validacao DNS multi-fonte, certificado e chave validados, Nginx runtime, Compose isolado com updater, retomada por estado material, bootstrap administrativo protegido, renovacao systemd, motor de update nao interativo, CLI manual separada, fila HMAC com replay protection, polling sanitizado e rollback transacional. O update agora separa health instalado, health candidato e health final, vincula backup e snapshot ao ID da transacao e bloqueia o health antigo enquanto o banco migrado nao tiver sido restaurado.

Nesta versao, MFA e opcional por padrao e possui politica persistente `optional`/`admins`/`all`, API e controle de Super Admin auditado. O CSRF e vinculado a sessao e centralizado no cliente HTTP. A troca da senha inicial continua obrigatoria e separada do MFA.

A conclusao interativa fecha e aguarda o pipeline sanitizado de log antes de escrever as credenciais no TTY original. Nenhum resumo ou diagnostico e enviado ao terminal depois do delimitador final; a informacao operacional continua no arquivo de instalacao.

O bootstrap publico sem argumentos seleciona `--install`, preserva os modos explicitos, propaga falhas do instalador interno e diferencia conclusao, simulacao, verificacao, retomada e cancelamento.

O ciclo do updater ativa `/opt/devflow/app` antes do estagio 14 com rollback atomico. O daemon publica `daemon.ready`, permanece healthy e suspende a fila enquanto `state/installation-in-progress` existir; a liberacao ocorre somente depois do Super Admin, health final, estado schema v3 e symlink definitivo.

O fechamento do instalador grava o estado atomicamente, valida e recarrega com o codigo instalado e executa o `health.sh --quiet` instalado em novo processo. O reparador de estado atua sem build, migration ou mutacao de banco/certificado/identidade. Esses fluxos foram validados localmente por testes estruturais e fixtures; a execucao operacional real permanece pendente.

O fluxo ACME temporário do DevFlow foi removido e substituído por Certbot standalone.

Nao executado nesta estacao Windows: Docker/Compose real, Certbot/ACME real, systemd real, firewall real, VPS, AMD64/ARM64 real, backup/restore contra PostgreSQL real e rollback induzido real.

O Documento 004 nao foi iniciado. O DevFlow permanece alpha e nao aprovado para producao.
