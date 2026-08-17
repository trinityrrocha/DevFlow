# Estado de implementacao

Data de corte: 2026-08-16. Versao: `0.6.32-alpha`.

Revisao 0.6.32 implementada localmente: tarefas podem ser movidas para uma lixeira auditável por Admin ou Super Admin e restauradas com o mesmo ID. O purge permanente é exclusivo de Super Admin, exige frase forte, remove dependências em ordem e usa quarentena de storage com compensação em rollback. A lista apresenta `URGENT_PRODUCTION` como Urgente, classifica apenas `BUG_REPORT` como Bug e agrupa a página corrente por etapa, responsável da etapa, prioridade ou tipo real. PostgreSQL e VPS reais permanecem pendentes de homologação do usuário.

Revisao 0.6.31 implementada localmente: o download administrativo deixa de gravar o ID opaco do backup na coluna UUID da auditoria, preserva esse identificador em `new_values` e transmite o arquivo por streaming. O frontend usa o cliente HTTP autenticado com resposta Blob, filename validado, Object URL temporária e tratamento do erro JSON. O SMTP foi compactado em quatro linhas dentro de um card responsivo de 590px; o tipo `BUG_REPORT` permanece associado diretamente ao ícone `Bug` de `lucide-react`. Download e layout reais na VPS permanecem pendentes de homologação do usuário.

Revisao 0.6.30 implementada localmente: timelines técnicas usam um eixo central com lados Backend/Frontend; Histórico alterna por índice sem alterar a ordenação cronológica; o stepper perdeu o card externo. Backups podem ser transmitidos por endpoint Super Admin usando catálogo sanitizado, raiz canônica, arquivo regular, tamanho validado e streaming. Lista de tarefas, SMTP, histórico administrativo e Dashboard receberam os novos contratos de UX, com detalhes paginados em uma consulta SQL por indicador. Navegador autenticado, PostgreSQL/Docker reais e VPS permanecem pendentes de homologação do usuário.

Revisao 0.6.27 implementada localmente: estados do catalogo de backup e estados operacionais foram separados; a reconciliacao de auditoria passou a isolar pedidos historicos invalidos sem mascarar catalogos corrompidos; mensagens terminais sao especificas por operacao. O bootstrap de tema agora e um recurso estatico same-origin executado no `head`, mantendo a CSP `script-src 'self'` sem `unsafe-inline`. A VPS permanece pendente de homologacao do usuario.

Revisao 0.6.25 implementada localmente: ThemeContext controla light/dark sem backend, persiste somente valores permitidos em `devflow-theme`, segue `prefers-color-scheme` sem escolha manual e aplica o tema antes do primeiro paint. Header, login, componentes globais e utilities legadas receberam cobertura escura indigo/slate. A tela de login foi verificada no navegador local em desktop e mobile; a navegacao autenticada e a VPS ainda dependem de homologacao do usuario.

Revisao 0.6.24 implementada localmente: o WebUpdater propaga explicitamente o contexto daemon; o pre-update e o health final usam `health.sh --daemon`, resolvem `devflow-nginx` na rede `devflow_edge` e mantêm TLS estrito. Somente arquivos de certificado e timer systemd, exclusivos do host, são reportados como `skipped-host-only`. Docker, HTTPS e WebUpdater reais ainda dependem de homologacao na VPS.

Revisao 0.6.23 implementada localmente: a migration 014 inclui `FRONTEND_APPROVAL` imediatamente após `FRONTEND` nos fluxos existentes e o seed aplica a sequência aos novos tenants. A etapa exige aprovação de Gestor/Admin; a interface registra aprovação ou reprovação, comentário e evidência antes de avançar ou devolver. QA remove Cliente e os dois perfis de desenvolvimento, e as timelines usam cards de 490 px (anexos com 171 px de altura). A VPS ainda depende de homologação.

Revisao 0.6.22 implementada localmente: backend e updater usam a raiz canônica `/var/lib/devflow/updater` sobre o mesmo bind mount persistente do host. O backend aceita apenas `DEVFLOW_UPDATER_QUEUE_DIR` absoluto, grava em `requests/` e registra o destino após a promoção atômica do arquivo. A VPS ainda depende de homologação.

Revisao 0.6.21 implementada localmente: ambiente e perfis do QA usam checkboxes, Backend/Frontend usam selects, testes e anexos seguem timelines centralizadas e os anexos têm cards de 350 x 122,15 px. O checklist próximo ao avanço apresenta evidências e os bloqueios obrigatórios calculados pelo backend, sem criar novas regras de transição. Navegador autenticado e VPS ainda dependem de homologação.

Revisao 0.6.20 implementada localmente: a migration 013 reconcilia bancos que registraram a 012 anterior quando `task_tests` estava vazia, removendo o trigger legado e garantindo `source_section VARCHAR(50)`. A 012 corrigida continua atendendo diretamente a VPS que sofreu rollback e nao registrou a migration. PostgreSQL, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.19 implementada localmente: a migration 012 remove com `DROP TRIGGER IF EXISTS` o trigger legado que bloqueava o backfill de `task_tests` com SQLSTATE `P0001`; a tabela e a coluna `source_section` usam DDL idempotente, UUIDs compativeis e `VARCHAR` com `CHECK`, sem ENUM. O trigger nao retorna porque QA agora aceita edicao auditada e exclusao logica. PostgreSQL, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.18 implementada localmente: a fila assinada usa o bind persistente `/opt/devflow/updater` em backend e updater, com caminhos internos absolutos e mesma raiz obrigatoria. Atualizacoes externas recriam o updater ao final para reconciliar instalacoes anteriores; pedidos internos nunca fazem autorrecriacao. O frontend troca definitivamente o polling do request por `/api/health` depois de 404/502/503/504 ou falha de rede e recarrega no primeiro HTTP 200. Docker, fluxo autenticado e VPS ainda dependem de homologacao.

Revisao 0.6.17 implementada localmente: registros de QA usam modelo estruturado, autoria da sessao, cards de 350 px e modal para cadastro, consulta e edicao; exclusao e logica e auditavel. Anexos registram a secao de origem e aparecem em timeline cronologica com autor e preview. Lint, testes e build foram validados localmente; PostgreSQL, navegador autenticado, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.16 implementada localmente: o polling da atualizacao usa um unico intervalo por request, timeout explicito, bloqueio de chamadas sobrepostas e estado terminal da fila com precedencia sobre a fase detalhada. A sequencia 503 seguida de resposta 200 `completed` aciona reload imediato; `failed` encerra o polling e apresenta falha segura. Lint, regressao e check integral foram validados localmente; reinicio real de containers e retorno da VPS ainda dependem de homologacao.

Revisao 0.6.15 implementada localmente: lead time usa o intervalo automatico da etapa e touch time usa sessoes manuais vinculadas a tarefa, etapa e usuario. Transicoes encerram ambos os ciclos antigos e reiniciam o controle manual da nova etapa; Roadmap nao gera nem exibe metricas. Imagens e videos possuem preview nativo, demais formatos usam icones por extensao e o backend entrega MIME canonico. Migration, lint, testes e build foram validados localmente; PostgreSQL, navegador autenticado, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.14 implementada localmente: o backend usa os quatro diretorios do daemon como autoridade do ciclo de vida e o arquivo `status/` apenas para a fase detalhada. O frontend preserva loading e polling em timeout/Network Error/502/503/504, mostra reinicio dos servicos e recarrega somente apos `completed`. Testes locais cobrem todas as transicoes; a troca real de containers e o retorno da VPS ainda dependem de homologacao.

Revisao 0.6.13 implementada localmente: a rota de timer usa lock de linha e autoria exclusiva da sessao, valida tarefa, permissao, estado, etapa e sobreposicao e tipa explicitamente todos os parametros do `UPDATE`/evento. O SQL antigo reproduziu `42P08` em PostgreSQL local e o SQL corrigido persistiu o estado `running` e o evento `STARTED`. Testes e lint do backend foram validados; a atualizacao e a operacao autenticada na VPS ainda dependem de homologacao.

Revisao 0.6.12 implementada localmente: o Monaco editavel usa `defaultValue`, conserva seu modelo sem atualizacoes React por tecla e entrega o conteudo por `editor.getValue()` somente no save. O wrapper possui altura minima de 400 px, foco por clique, borda, padding, placeholder e loading; arquivo e linguagem foram alinhados. Testes e build locais cobrem o contrato, mas a interacao autenticada em navegador e a VPS ainda dependem de homologacao.

Revisao 0.6.11 implementada localmente: o estagio Docker do frontend recebe `NODE_OPTIONS=--max-old-space-size=4096` imediatamente antes do build e o Rollup isola `monaco-editor` e `@monaco-editor` em chunk dedicado. A mudanca corrige a causa identificada do rollback de `0.6.10-alpha`. O build local foi validado; Docker e VPS reais dependem de nova homologacao.

Revisao 0.6.10 implementada localmente: pedido de atualizacao restrito ao Super Admin com sessao valida e CSRF, sem gate de MFA inclusive quando a politica global exige configuracao; toggle unico do cronometro com spinner e bloqueio concorrente, sem cancelamento na API de tempo; controller de estado com respostas JSON 400/404/409 e falha interna 500 sanitizada. A base Monaco e as migrations 009/010 foram verificadas sem reescrita. Navegador autenticado, PostgreSQL, Docker e VPS reais ainda dependem de homologacao.

Revisao 0.6.9 implementada localmente: Monaco reutilizavel com configuracao segura, Pascal/Delphi e PowerShell, deteccao automatica reversivel sem sobrescrever escolha manual, tema observado no documento, previews expansivos sob demanda, validacao de codigo obrigatorio e limite UTF-8 de 200 KB. A migration 010 acrescenta exclusao logica auditavel aos cards sem alterar as migrations 008/009 publicadas. PostgreSQL, Docker, console do navegador e VPS reais ainda dependem de homologacao.

Revisao 0.6.8 implementada localmente: lista de tarefas sem subtitulo redundante e com cabecalho de maior contraste; controle unico e reativo do cronometro; erros de transicao conhecidos em JSON 400/404/409; anotacoes GitHub estruturadas com arquivo, linguagem, codigo, explicacao, autor e etapa; Monaco Editor e workers empacotados localmente; pedido fisico do updater gravado atomicamente na fila HMAC e monitoramento de indisponibilidade/retorno pelo health. A migration 009, o updater em container e os fluxos contra PostgreSQL/Docker/VPS reais ainda dependem de homologacao.

Revisao 0.6.7 implementada localmente: SMTP persistente cifrado e teste direto, lista compacta e ordenada, erros conhecidos do cronometro em 400/409, registros GitHub 1:N e solicitacao de update com MFA e polling do health. A migration 008 e a operacao em PostgreSQL/Docker/VPS ainda dependem de homologacao.

Fase 4 concluida localmente: notificacoes internas paginadas, preferencias, eventos de etapa/atribuicao/atraso/conclusao, recuperacao de senha e outbox transacional cifrada. O worker usa claim concorrente, idempotencia, retry/backoff e auditoria sem conteudo sensivel. SMTP, entrega real, PostgreSQL em container e operacao do worker na VPS permanecem pendentes de homologacao manual.

Fase 3 concluida localmente: tarefas em Roadmap sao visiveis somente ao criador, Admin e Super Admin; fora dele, somente participantes, responsaveis de projeto e administradores. O gate cobre lista/busca/detalhe/relacionados/anexos/comentarios/testes/notificacoes/dashboard. Estimativa em segundos, estados explicitos de timer, acumulado persistido, timestamps, atraso, filtro, UI e historico foram implementados. Concorrencia e reinicio foram validados por contrato e calculos unitarios; PostgreSQL/VPS real permanece pendente.

Fase 2 concluida localmente: telefone E.164 opcional, e-mail proprio pendente ate confirmacao com token aleatorio armazenado por hash, administracao de nome/e-mail/telefone/papel/perfis/status, redefinicao de senha temporaria, remocao auditada de MFA, revogacao de sessoes e painel de auditoria de sessoes. SMTP real e entrega do e-mail de confirmacao dependem de homologacao manual.

Fase 1 concluida localmente: navegacao superior responsiva sem menu lateral, dropdowns com ARIA/teclado/Escape, rotas canonicas com compatibilidade, paginas independentes de Clientes e Projetos, autorizacao backend separada para leitura/gestao e Nova Tarefa restrita a `/task`. CRUD, filtros, paginacao, associacao de equipe e bloqueio de exclusao com vinculos foram cobertos por validacoes locais e simuladas. Homologacao visual em navegador e VPS permanece pendente.

Implementado localmente: Certbot standalone do host, validacao DNS multi-fonte, certificado e chave validados, Nginx runtime, Compose isolado com updater, retomada por estado material, bootstrap administrativo protegido, renovacao systemd, motor de update nao interativo, CLI manual separada, fila HMAC com replay protection, polling sanitizado e rollback operacional. O update separa health instalado, health candidato e health final, preserva o snapshot do estado instalado e nao cria, seleciona ou restaura backup de dados automaticamente. Se migrations tiverem alterado o banco, a transacao registra a possibilidade de restore administrativo manual.

Nesta versao, MFA e opcional por padrao e possui politica persistente `optional`/`admins`/`all`, API e controle de Super Admin auditado. O CSRF e vinculado a sessao e centralizado no cliente HTTP. A troca da senha inicial continua obrigatoria e separada do MFA.

A conclusao interativa fecha e aguarda o pipeline sanitizado de log antes de escrever as credenciais no TTY original. Nenhum resumo ou diagnostico e enviado ao terminal depois do delimitador final; a informacao operacional continua no arquivo de instalacao.

O bootstrap publico sem argumentos seleciona `--install`, preserva os modos explicitos, propaga falhas do instalador interno e diferencia conclusao, simulacao, verificacao, retomada e cancelamento.

O ciclo do updater ativa `/opt/devflow/app` antes do estagio 14 com rollback atomico. O daemon publica `daemon.ready`, permanece healthy e suspende a fila enquanto `state/installation-in-progress` existir; a liberacao ocorre somente depois do Super Admin, health final, estado schema v3 e symlink definitivo.

O fechamento do instalador grava o estado atomicamente, valida e recarrega com o codigo instalado e executa o `health.sh --quiet` instalado em novo processo. O reparador de estado atua sem build, migration ou mutacao de banco/certificado/identidade. Esses fluxos foram validados localmente por testes estruturais e fixtures; a execucao operacional real permanece pendente.

O fluxo ACME temporário do DevFlow foi removido e substituído por Certbot standalone.

Nao executado nesta estacao Windows: Docker/Compose real, Certbot/ACME real, systemd real, firewall real, VPS, AMD64/ARM64 real, backup/restore contra PostgreSQL real e rollback induzido real.

O Documento 004 nao foi iniciado. O DevFlow permanece alpha e nao aprovado para producao.
