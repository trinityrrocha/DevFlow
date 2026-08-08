# Changelog

## [0.6.6-alpha] - 2026-08-07

### Corrigido

- filtro de projetos deixa de enviar UUID vazio e o backend normaliza clientes sem filtro;
- eventos do cronometro usam mapeamento explicito, incluindo `CANCELLED`;
- botao de atualizacao pode ser reutilizado depois de uma solicitacao concluida ou com falha.

### Adicionado

- codigos de clientes e projetos gerados no backend e imutaveis pela API;
- perfis validados e anexo de evidencia em testes, anexos em comentarios e conversa em formato de chat;
- referencia de codigo em alteracao nos metadados GitHub;
- submenu de Servidor SMTP com configuracao sanitizada e teste pela outbox.

## [0.6.5-alpha] - 2026-08-07

### Corrigido

- health candidato com versao, commit, migration e tags de imagem explicitos, sem promover antecipadamente o estado instalado;
- promocao atomica da release seguida por `installation.json` schema v3, health interno estrito e health publico;
- backup pre-update autenticado pelo ID da transacao, identidade anterior, migration, snapshot e hashes;
- rollback apos migrations com restore obrigatorio do PostgreSQL e uploads antes de release, estado, containers e health antigos;
- imagens anteriores preservadas por ID/tag imutavel, candidata identificada pelo commit e worker removido quando ausente na topologia anterior;
- transacao schema v2 com estados finais nao ambiguos e gate de recuperacao manual quando o banco nao puder ser restaurado.

### Validacao

- fixture reproduz a tentativa `0.5.5-alpha` para `0.6.4-alpha`, incluindo estado instalado antigo durante o candidate health;
- 40 cenarios locais cobrem candidate health, promocao, backup, rollback antes/depois de migrations, falha de restore e imagens.

## [0.6.4-alpha] - 2026-08-06

### Corrigido

- motor `update.sh` totalmente nao interativo, sem dependencia de TTY ou validacao de requests web;
- CLI manual separada em `update-cli.sh`, com check, changelog, confirmacao numerica e cancelamento normal;
- daemon com fila autenticada, replay protection, lock, recuperacao de requests interrompidos e status sanitizado;
- bootstrap de update para instalacoes antigas, releases imutaveis e rollback sem comandos Git destrutivos;
- painel do Super Admin com versoes, changelog, salvaguardas e polling do estado da atualizacao.

### Seguranca

- allowlist exata de remotes e servicos, sem controle de Compose pela API e sem recriar o updater em execucao;
- backup verificado, manutencao HTTP 503, migrations sob lock, health e rollback automatico preservados.

## [0.6.3-alpha] - 2026-08-06

### Adicionado

- notificacoes internas paginadas, contador, leitura individual/coletiva e links contextuais;
- preferencias por usuario para canais, movimentacoes, atribuicoes e atrasos, mantendo seguranca critica obrigatoria;
- recuperacao de senha com resposta neutra, token aleatorio armazenado por hash, expiracao, uso unico e revogacao de sessoes;
- outbox transacional cifrada, idempotencia, worker dedicado, retry exponencial, timeout e auditoria sanitizada;
- teste SMTP enfileirado exclusivo do Super Admin e configuracao por ambiente sem exposicao de credenciais.

### Seguranca

- notificacoes e jobs de etapa sao gravados antes do commit e enviados somente depois pelo worker;
- tarefas em Roadmap nao vazam por atribuicoes, contadores ou notificacoes;
- payloads temporarios de e-mail sao protegidos por AES-256-GCM e apagados depois da entrega;
- recuperacao invalida tokens anteriores e encerra todas as sessoes abertas.

## [0.6.2-alpha] - 2026-08-06

### Adicionado

- estimativa de desenvolvimento em segundos, apresentada como `dd-hh-mm`;
- cronometro com estados `not_started`, `running`, `paused`, `completed` e `cancelled`;
- tempo produtivo restante, tempo corrido desde o inicio, atraso e filtro de tarefas atrasadas;
- historico imutavel de inicio, pausa, retomada, conclusao, cancelamento, estimativa e atraso.

### Seguranca

- Roadmap restrito no backend ao criador, Admin e Super Admin;
- fora do Roadmap, acesso limitado a participantes, responsaveis do projeto e administradores;
- predicados de visibilidade aplicados a busca, detalhe, relacionados, anexos, notificacoes e dashboard;
- operacoes de cronometro autorizadas pela responsabilidade da etapa e serializadas por lock no PostgreSQL.

## [0.6.1-alpha] - 2026-08-06

### Adicionado

- telefone opcional validado no formato internacional E.164;
- fluxo de alteracao do proprio e-mail com senha atual, e-mail pendente, token aleatorio com hash/expiracao e confirmacao;
- edicao administrativa de usuario, senha temporaria, troca obrigatoria, reset de MFA e historico basico;
- inventario de sessoes com login, ultimo acesso, IP, user-agent resumido, status e motivo de encerramento;
- encerramento auditado de sessao individual ou de todas as sessoes de um usuario.

### Seguranca

- Admin nao administra Super Admin e nao eleva usuarios a Super Admin;
- ultimo Super Admin e ultimo Admin ativos sao protegidos;
- alteracoes de identidade, senha, papel, status, e-mail e MFA revogam sessoes aplicaveis;
- senhas temporarias, tokens, hashes de sessao e cookies nao sao gravados em auditoria.

## [0.6.0-alpha] - 2026-08-06

### Adicionado

- navegacao superior responsiva com dropdowns acessiveis, operacao por teclado e indicacao de rota ativa;
- paginas proprias de Clientes e Projetos com pesquisa, filtros, paginacao, edicao, ativacao e exclusao protegida por vinculos;
- permissoes `clients.view`, `clients.manage` e `projects.view`, aplicadas no backend por tenant;
- associacao de equipe aos projetos e contagem dos vinculos de tarefas.

### Alterado

- rotas canonicas passam a usar `/dashboard`, `/task`, `/team`, `/clients` e `/projects`, com redirecionamentos das rotas anteriores;
- botao Nova Tarefa foi removido do layout global e movido para a pagina de tarefas;
- MFA, catalogos, fluxos e atualizacoes foram separados em rotas de Sistema.

## [0.5.5-alpha] - 2026-08-05

### Corrigido

- a conclusao interativa agora drena o logger antes de exibir as credenciais iniciais no TTY original;
- o bloco de credenciais passa a ser a ultima saida visivel e remove caminho protegido, resumo, health e diagnosticos internos;
- informacoes operacionais continuam preservadas no log de instalacao, inclusive em execucao sem TTY.

### Validacao local

- os testes estruturais confirmam a ordem de drenagem, o delimitador final e a ausencia de saida posterior ao bloco;
- a instalacao real na VPS permanece pendente de homologacao pelo usuario.

## [0.5.4-alpha] - 2026-08-05

### Corrigido

- a politica persistente de MFA passa a usar `optional` por padrao, com opcoes `admins` e `all` controladas exclusivamente pelo Super Admin e auditadas;
- a troca obrigatoria da senha temporaria permanece independente da configuracao voluntaria de MFA;
- tokens CSRF sao vinculados a sessao, enviados pelo cliente HTTP central em operacoes mutaveis e renovados com no maximo uma repeticao para `CSRF_INVALID`;
- a rota de setup de MFA deixa de ser confundida com a rota isenta de verificacao do segundo fator;
- a leitura shell do `schemaVersion` numerico foi corrigida e o instalador agora valida/recarrega o estado com o codigo instalado antes de executar um novo processo de health;
- a senha inicial e exibida uma unica vez no TTY original, somente depois do health aprovado, sem passar pelo log;
- `repair-installation-state.sh` permite diagnosticar ou reparar apenas o estado schema v3 de uma instalacao existente, preservando dados, identidade, certificado e credencial.

### Validacao local

- 40 cenarios obrigatorios cobrem MFA, CSRF, estado instalado, reparo e credencial inicial;
- testes unitarios exercitam a politica de MFA e o contrato CSRF vinculado a sessao;
- VPS, Docker, Certbot, systemd, navegador e aplicativo autenticador reais permanecem pendentes de homologacao pelo usuario.

## [0.5.3-alpha] - 2026-08-04

### Corrigido

- o instalador ativa `/opt/devflow/app` atomicamente antes de criar ou iniciar o updater no estagio 14;
- falhas restauram um symlink anterior validado ou removem somente o symlink candidato de uma instalacao inicial;
- `installation-in-progress`, protegido como `root:root 0600`, mantem o daemon saudavel e bloqueia o consumo da fila ate o health e o estado final serem confirmados;
- o updater ganhou `start_period`, diagnostico sanitizado de falha e gates explicitos para daemon, ready file, container e Nginx;
- a retomada de uma falha no estagio 14 reconstrói/recria somente updater e edge quando necessario, preservando banco, backend, frontend e migration saudaveis.

### Validacao local

- 24 cenarios obrigatorios validam symlink antecipado, rollback, marcador, ready file, health, preservacao material e retomada do estagio 14;
- Docker, Certbot e a retomada real na VPS permanecem pendentes de homologacao pelo usuario.

## [0.5.2-alpha] - 2026-08-04

### Corrigido

- `sudo ./install.sh` agora seleciona explicitamente `--install` no bootstrap publico quando nenhuma opcao de modo e informada;
- `--check`, `--dry-run`, `--install` e `--resume` preservam suas semanticas explicitas;
- execucao nao interativa de instalacao exige dominio, e-mail administrativo e confirmacao do firewall antes de qualquer mutacao;
- cancelamento informa `changes_applied=false`, falhas internas preservam o exit code e mensagens finais distinguem verificacao, simulacao, instalacao e retomada;
- testes de interface reproduzem a chamada publica sem argumentos e impedem a regressao para um preflight sem instalacao.

### Validacao local

- o fluxo publico foi exercitado com fixtures Bash e stubs sem rede ou mutacoes privilegiadas;
- a instalacao real na VPS, Docker e Certbot permanecem pendentes de execucao pelo usuario.

## [0.5.1-alpha] - 2026-08-04

### Corrigido

- O fluxo ACME temporário do DevFlow foi removido e substituído por Certbot standalone.
- DNS A e IPv4 publico agora sao comparados por fontes independentes; portas e firewall falham de forma fechada.
- certificado, SAN, validade, symlinks e chave privada sao validados antes da geracao do Nginx runtime;
- falhas de instalacao preservam containers e `--resume` recalcula o ponto material da instalacao parcial;
- PostgreSQL, backend, frontend, Nginx e updater seguem inicializacao ordenada e health checks reais;
- renovacao usa Certbot do host, timer systemd e reload escopado ao `devflow-nginx`;
- frontend/backend podem criar somente pedidos HMAC `install-update`; o daemon privado delega exclusivamente ao `update.sh`.

### Validacao local

- 30 cenarios obrigatorios cobrem standalone, DNS, portas, certificado, Compose, ordem, retomada, admin, renovacao, updater, rollback e desinstalacao;
- Docker, Compose, Certbot, ACME, systemd e AMD64/ARM64 reais permanecem pendentes de homologacao manual na VPS.

> Entradas anteriores a `0.5.0-alpha` descrevem a arquitetura compartilhada historica, descontinuada e removida como caminho operacional.

## [0.5.0-alpha] - 2026-08-04

### Alterado

- o DevFlow passa a suportar exclusivamente instalacao isolada, com Nginx, Certbot, containers, redes, storage e certificados proprios;
- o instalador interativo solicita somente dominio e e-mail administrativo, usa confirmacoes numericas e bloqueia 80/443 ocupadas sem adaptar terceiros;
- o fluxo transacional possui 16 etapas, ACME HTTP antes de HTTPS, retomada segura e estado final schema v3;
- PostgreSQL permanece apenas na rede interna; frontend e backend nao publicam portas no host;
- `update.sh` permanece como motor unico para terminal e futura API allowlisted, com backup, manutencao, migrations, health e rollback;
- health, diagnostico e uninstall foram reduzidos ao namespace exclusivo do DevFlow.

### Removido

- providers `host-nginx`, `legacy-docker-nginx` e o antigo wrapper de provider isolado;
- adapters, overlays e fixtures de proxy compartilhado;
- publicacao separada, migracao de proxy, escopo interno, reconciliacao e reparos especificos da arquitetura compartilhada.

### Validacao

- 30 cenarios obrigatorios verificam instalacao isolada, portas, DNS, e-mail unico, arquiteturas, migrations, Nginx, ACME, HTTPS, renovacao, rollback, update, backup, restore, uninstall, limites de rede e desacoplamento;
- Docker/ACME/ARM64 reais continuam pendentes de homologacao manual na VPS.

## [0.4.13-alpha] - 2026-08-04

### Corrigido

- o build backend deixa de herdar permissões `0700/0600` do checkout e normaliza `/database` e `/database/migrations` como `root:root 0755`, com todos os arquivos regulares em `0644`;
- o build rejeita diretório ausente/vazio, symlink, entrada não regular, ownership ou modos divergentes e executa o contrato novamente como `USER devflow`;
- o probe operacional continua sem override de usuário, exige `Config.User=devflow`, UID não root, leitura/travessia, ausência de escrita/execução e SHA-256 correto;
- `EACCES` no diretório e no arquivo agora são classificados como `migration-directory-permission-denied` e `expected-migration-permission-denied`, em vez de erro inesperado do runtime;
- instalação, resume, update e reconciliação tratam violações de permissões como imagem inválida antes de migrations, manutenção ou promoção.

### Validação

- 29 cenários específicos cobrem os 28 requisitos de permissões e o comando oficial não root; o validador direto cobre também os marcadores de `EACCES` e usuário configurado;
- Docker não está disponível na estação Windows, portanto build Alpine/ARM64 e execução real das migrations permanecem pendentes de homologação manual na VPS.

## [0.4.12-alpha] - 2026-08-04

### Corrigido

- a validação da imagem candidata calcula a migration esperada a partir do checkout canônico, compara seu SHA-256 e vincula a inspeção ao ID imutável da imagem antes e depois do probe;
- o probe usa o runtime Node da própria imagem, sem quoting do BusyBox, e diferencia diretório ausente, arquivo ausente, arquivo não regular, conteúdo divergente, troca de referência e falha do runtime;
- a reconciliação registra referências, IDs, migration, resultado da validação, causa e rollback em estado transacional schema v2;
- `--retain-failed-candidates` preserva opcionalmente tags diagnósticas após o rollback, imprime comandos exatos de inspeção/remoção e nunca promove ou executa as candidatas;
- `health.sh` considera publicação externa habilitada somente quando o estado consistente também possui transação de publicação concluída para o mesmo domínio/provider e certificado DevFlow ativo.

### Validação

- a validação Docker real não foi executada nesta estação Windows porque Docker não está disponível;
- testes locais com mocks/fixtures cobrem o nome dinâmico, códigos de saída, identidade da imagem, conteúdo, retenção e estado; a nova homologação operacional permanece pendente de execução manual na VPS.

## [0.4.11-alpha] - 2026-08-04

### Corrigido

- `installation.json` passa ao schema v2 estrito com somente os 17 campos operacionais definitivos; versão, commit, ref e repositório são derivados exclusivamente de `/opt/devflow/source`;
- `publish.sh` passa a ser seguro por padrão e oferece `--check`, `--dry-run`, `--publish` e `--rollback`, com backup persistente do estado, rollback automático em falha parcial e remoção seletiva apenas do certificado criado pela transação;
- o provider `host-nginx` valida layouts `sites-available/sites-enabled` e `conf.d`, Certbot, renewal timer, hook, certificado, `nginx -t`, reload e restauração;
- o vhost compartilhado cobre WebSocket, uploads, restore, downloads, CSP, HSTS, rate limit, timeouts, buffers e gzip;
- `health.sh` expõe prontidão de provider, proxy, publicação, certificado, renovação, rollback, identidade, estado e adapter, além de `overall_health`;
- `update-operation.sh` estabelece o contrato reutilizável `check-update`, `download-update`, `validate-update`, `install-update` e `rollback-update`; o rollback manual reutiliza a transação e o backup autenticado do updater.
- a migração controlada do proxy promove `proxyMigrationExecuted` no estado v2 e restaura o snapshot do estado em rollback automático, sem escrever no repositório Full Password.

### Validação

- 48 checks finais não mutantes cobrem publicação, rollback, provider, certificados, release, estado, atualização, host Nginx, proxy e health;
- a prova local é estrutural/simulada; emissão TLS, portas públicas, reload e rollback completos ainda devem ser executados na VPS de homologação antes de classificar o modo compartilhado como homologado em ambiente real.

Todas as alterações relevantes do DevFlow são registradas neste arquivo.

## [0.4.10-alpha] - 2026-08-03

### Corrigido

- criada reconciliação transacional separada para reconstruir somente backend/frontend a partir de `/opt/devflow/source`, sem promover o código operacional mais novo para a release instalada;
- imagens candidatas recebem versão e revision OCI canônicas, passam por validação isolada e substituem apenas os dois serviços da aplicação;
- IDs e tags anteriores, configuração privada e estado JSON são preservados para rollback automático; container, mount e migration do PostgreSQL são verificados antes e depois;
- APIs de releases legadas sem campo `commit` são classificadas como `unsupported-by-installed-release`, sem relaxar a validação de versão ou das imagens;
- publicação externa, update e reparo de estado são serializados contra a reconciliação, que não altera proxy, Full Password, portas públicas ou migrations.

### Homologação

- 20 cenários obrigatórios cobrem promoção, rollback, preservação, modos, API legada, idempotência e bloqueio de publicação;
- a execução real de `--reconcile` na instalação `0.4.8-alpha` permanece pendente na VPS ARM64.

## [0.4.9-alpha] - 2026-08-03

### Corrigido

- a identidade instalada passa a ser resolvida exclusivamente pelo checkout canônico protegido em `/opt/devflow/source`, eliminando o commit antigo recarregado do `.env` durante uma retomada;
- `installation.json` adota `schemaVersion: 1`, nomes camelCase únicos, validação estrita e gravação atômica com `fsync` e permissões `root:root 600`;
- o reparador idempotente cria backup protegido antes de migrar somente os metadados, sem reiniciar containers, executar migrations ou tocar no proxy;
- health, version, backup, restore, diagnose, publish e update consultam a mesma identidade central; publicação e update permanecem bloqueados enquanto o estado estiver inconsistente;
- update registra `previousInstalledCommit` e somente promove o commit candidato depois dos health checks; rollback valida e restaura a identidade anterior comprovada;
- a API de health inclui o commit sanitizado e a reconciliação confirma versão e revision OCI de backend/frontend.

### Homologação

- 25 cenários obrigatórios mais o gate de publicação cobrem checkout, schema, backup, atomicidade, idempotência, modos, update, rollback e preservação;
- a instalação interna `0.4.8-alpha` está saudável na VPS ARM64; o reparo real do commit legado e o dry-run da publicação externa permanecem pendentes.

## [0.4.8-alpha] - 2026-08-03

### Corrigido

- a validação dos artefatos de migration deixou de criar um container pelo Compose antes das redes e passa a inspecionar diretamente a imagem resolvida com `docker run --rm --network none`;
- marcadores internos diferenciam diretório ausente, migration inicial ausente e falha do runtime Docker, evitando falsos negativos de conteúdo;
- stdout é aceito somente por allowlist e stderr recebe sanitização antes do diagnóstico, sem ambiente, volumes ou redes do serviço;
- install e update fornecem explicitamente a imagem já resolvida ao validador independente de provider;
- o estado transacional registra `rootCause` e avança de `completed_stage=06-validate-images` para `resume_from_stage=07-create-networks`.

### Testes e homologação

- 24 cenários automatizados cobrem imagem válida/inválida, redes ausentes, modos compartilhado/isolado, providers, runtime Docker, sigilo, retomada, ARM64 e preservação do Full Password;
- a imagem `devflow-backend:latest` da tentativa `0.4.7-alpha` foi comprovada correta diretamente na VPS; o falso negativo ocorreu antes da execução do comando interno;
- Docker 29.6.1, Compose 5.3.1 e a retomada real da etapa 06 permanecem pendentes de repetição após esta publicação.

## [0.4.7-alpha] - 2026-08-03

### Corrigido

- `MIGRATIONS_DIR=/database/migrations` agora é permanente na imagem e explícito no serviço backend do Compose, inclusive quando `docker compose run` substitui o `CMD`;
- o executor valida diretório e arquivos antes de conectar ao PostgreSQL, bloqueia diretório vazio e registra somente caminho, quantidade, estado e código de saída sanitizados;
- install e update usam um único comando de migration, e a imagem candidata comprova a presença de `001_initial_schema.sql` antes de alterar o schema;
- a retomada com PostgreSQL saudável preserva container e dados, mantém `resume_from_stage=09-run-migrations`, reconstrói o backend alterado e reutiliza o frontend anterior somente com proveniência comprovada;
- confirmações interativas deixaram de aceitar frases livres e usam menus numéricos fail-closed, com cancelamento controlado e rejeição de execução sem TTY.

### Testes e homologação

- 20 cenários automatizados cobrem migrations, transação, lock, retomada ARM64, PostgreSQL 16 Alpine, preservação do banco e Full Password;
- 16 cenários cobrem escolhas, entradas inválidas, ausência de TTY, interrupção, sigilo e os três menus de instalação;
- Docker/Compose e PostgreSQL reais não foram executados no Windows; a retomada da etapa 09 permanece pendente na VPS ARM64.

## [0.4.6-alpha] - 2026-08-03

### Corrigido

- todas as operações Compose do DevFlow agora usam o construtor único `build_devflow_compose_command`, sempre com `--project-directory`, `--env-file` e arquivos Compose validados;
- o dry-run de instalação parcial usa `/opt/devflow/config/devflow.env` para a interpolação runtime, sem carregar o arquivo como código shell, copiá-lo ou exibir valores;
- uma instalação nova sem env realiza somente validação estrutural com placeholders temporários não secretos;
- falhas de renderização são classificadas antes do resolvedor de imagens, eliminando a mensagem secundária incorreta sobre imagem ausente;
- stderr do Compose não é reproduzido: somente categoria, nome permitido da variável e caminho esperado são registrados;
- configuração parcial inválida retoma da etapa `04-configuration`; se não houver banco, volume ou migration, a recuperação exige confirmação literal e preserva cópia protegida;
- qualquer evidência de dados persistentes bloqueia regeneração de senha e exige recuperação manual.

### Testes e homologação

- 24 cenários cobrem env válido, ausente, protegido, valores especiais, não execução de dotenv, renderização, JSON, sanitização, retomada, ARM64, Compose 5.3.1 e fail-closed;
- uma auditoria dedicada impede novas construções Compose divergentes fora da biblioteca central;
- Docker/Compose reais, recuperação da configuração e retomada ainda precisam ser repetidos na VPS ARM64.

## [0.4.5-alpha] - 2026-08-03

### Corrigido

- eliminado o encerramento silencioso causado pelas linhas 233–234 de `scripts/install.sh` no commit `1152236`: uma verificação booleana de etapa retornava `1` como status final de `detect_partial_installation`, chamada diretamente sob `set -e`;
- um trap sanitizado e um logger protegido em `/tmp/devflow-install-bootstrap.*.log` agora existem antes de qualquer import potencialmente falível;
- argumentos ausentes ou desconhecidos produzem erro funcional e dica de `--help`, sem `shift` além dos argumentos;
- `--resume` exige a confirmação exata `RETOMAR DEVFLOW` e nunca prossegue silenciosamente;
- leituras Git do clone fornecido usam `GIT_OPTIONAL_LOCKS=0` e uma assinatura de integridade comprova que `.git/index` não mudou.

### Retomada legada

- a ausência de `install-transaction.json` é tratada como evidência esperada de uma tentativa anterior à transação;
- source, configuração, imagens, containers e estado são classificados separadamente;
- o dry-run apenas planeja a reconstrução; a gravação atômica acontece somente depois da confirmação do `--resume`;
- o estado reconstruído registra origem legada e etapa real de retomada, sem segredos;
- imagens antigas permanecem preservadas e são reconstruídas com cache quando não comprovam versão e commit.

### Testes e homologação

- 26 cenários cobrem imports, `set -e`, logger inicial, parsing, estado legado, clone read-only, sigilo, ARM64, Compose 5.3.1 e fail-closed;
- a execução real de dry-run e retomada permanece pendente na VPS ARM64; nenhuma instalação, publicação externa ou migração foi executada nesta correção local.

## [0.4.4-alpha] - 2026-08-03

### Corrigido

- a identificação de imagens deixou de usar `docker compose images -q backend`, que retorna vazio antes da criação do container mesmo após uma build bem-sucedida;
- backend, frontend e PostgreSQL agora são resolvidos pelo JSON do Compose, normalizados sem confundir registries e confirmados por `docker image inspect`;
- backend e frontend possuem nomes explícitos e rótulos OCI de versão e commit para permitir reutilização comprovada;
- `health.sh` diferencia presença das imagens, saúde dos containers, migration e saúde interna.

### Retomada

- `install.sh --resume` reconhece uma instalação parcial somente quando checkout, configuração e avanço de commit são seguros;
- 14 etapas formais são persistidas atomicamente em `/opt/devflow/state/install-transaction.json`, sem segredos;
- falhas preservam checkout, configuração e imagens válidas, removendo apenas recursos incompletos do DevFlow;
- imagens antigas sem rótulos de proveniência são reconhecidas como presentes, mas reconstruídas uma vez para comprovar versão e commit.

### Testes e homologação

- 24 cenários cobrem resolução, normalização, imagens ausentes, Compose fora do diretório, retomada, estado transacional, rollback preservando imagens, ARM64 e Compose 5.3.1;
- a falha real ocorreu em Ubuntu 24.04.4 ARM64 após construir `devflow-backend:latest` e `devflow-frontend:latest`; nenhum container DevFlow foi iniciado e o Full Password permaneceu inalterado;
- a retomada real, migrations, containers e health ainda dependem de execução na VPS; nenhuma publicação externa foi realizada nesta correção local.

## [0.4.3-alpha] - 2026-08-02

### Adicionado

- instalação interna explícita por `--install-internal` ou `--install-scope internal`, sem dependência de domínio, Nginx ou HTTPS;
- publicação posterior transacional em `scripts/publish.sh`, sem reinstalar a aplicação ou executar migrations;
- estado operacional por escopo em `/opt/devflow/state/installation.json` e health interno independente de HTTPS;
- acesso de homologação por túnel SSH documentado.

### Corrigido

- propriedade de 80/443 agora cruza `ss`, `docker ps`, `docker inspect` e `docker port`, reconhecendo `fullpassword_nginx` somente com evidência coerente;
- ocupação das portas públicas bloqueia somente publicação, ACME e migração, sem impedir containers e serviços locais;
- frontend e backend permanecem vinculados a `127.0.0.1`; PostgreSQL continua sem porta publicada no host;
- o frontend interno encaminha `/api/` diretamente ao backend pela rede Docker.

### Segurança

- o escopo interno não altera Full Password, `/etc/nginx`, certificados, portas 80/443 ou configurações de proxy;
- falhas internas removem somente recursos incompletos do DevFlow e preservam dados e infraestrutura de terceiros.

### Homologação

- `0.4.2-alpha` teve `--check` executado na VPS ARM64; o dry-run completo foi bloqueado antes de alterações pela classificação anterior;
- `0.4.3-alpha` ainda depende de novo check, dry-run interno e instalação interna na VPS;
- nenhuma instalação, publicação ou migração foi executada nesta alteração local.

## [0.4.2-alpha] - 2026-08-02

### Corrigido

- o bootstrap público deixou de fixar uma versão alpha e passa a detectar o SemVer do checkout validado de `main`;
- `--ref vSEMVER` e `--expected-version SEMVER` oferecem pin explícito, com divergência detalhada e sem `eval`;
- origem, referência, commit remoto, limpeza, arquivos rastreados, ausência de symlinks e consistência entre componentes permanecem fail-closed;
- a política SemVer, leitura estrita de `VERSION`, comparação e consistência foram centralizadas em `scripts/lib/version.sh` e reutilizadas por bootstrap, install, update, version e health;
- o updater aceita pin opcional e valida a árvore Git remota antes de backup ou qualquer mutação.

### Testes

- 19 cenários cobrem evolução dinâmica de `main`, tags, pins, SemVer, divergências, identidade Git, commit e ausência de mutação em falha;
- auditoria de constantes classifica ocorrências históricas e bloqueia versões antigas em configuração operacional.

### Homologação

- a tentativa real anterior foi interrompida antes da instalação pelo bootstrap desatualizado;
- nenhuma instalação real foi executada nesta correção;
- esta versão alpha permanece não aprovada para produção.

## [0.4.1-alpha] - 2026-08-02

### Corrigido

- `--check` e `--dry-run` da migração agora apresentam mappings reais, ocupação da porta `127.0.0.1:18081`, estado do Nginx do host, saúde funcional do Full Password e blockers allowlisted;
- o override temporário é validado com o Docker Compose real sem expor o JSON interpolado, comparando serviços, mounts, redes, ambiente, restart e a única troca de portas permitida;
- o Compose original é validado separadamente como fonte de rollback para as portas públicas 80/443;
- o vhost planejado preserva frontend, API, restore de backup, limites de upload, timeouts e headers de encaminhamento;
- a futura transação valida frontend, API e fronteira de autenticação pelo loopback antes de iniciar o Nginx do host;
- rollback para primeiro o Nginx do host, comprova liberação das portas, restaura somente `fullpassword_nginx` e valida o serviço publicamente.

### Evidências

- relatório sanitizado do dry-run em `/var/log/devflow/proxy-migration-dry-run.log`, sem conteúdo do ambiente ou credenciais;
- 21 cenários automatizados cobrem gates, falhas antes/depois da troca, listeners, Compose, rollback, sigilo e cálculo de readiness;
- `migration_ready=true` somente é emitido quando todos os gates aplicáveis e o rollback estão comprovados.

### Homologação

- nenhuma migração, troca de porta, parada de container, inicialização/reload de Nginx ou emissão de certificado foi executada nesta etapa;
- o teste runtime de `127.0.0.1:18081` permanece corretamente como `not-executed` durante o dry-run;
- esta versão alpha não está aprovada para produção.

## [0.4.0-alpha] - 2026-08-02

### Adicionado

- contrato versionado de providers e estado persistente em `/opt/devflow/state/infrastructure-provider.json`;
- provider padrão `host-nginx`, provider isolado e adaptador Docker legado explícito;
- virtual host atômico em `sites-available/sites-enabled`, fallback `conf.d`, TLS, health e renovação Certbot;
- utilitário separado de migração do proxy com check, dry-run, dupla confirmação, override neutro e rollback;
- validações automatizadas para provider, loopback, isolamento do banco, migração e preservação de terceiros.

### Alterado

- frontend e API do provider padrão são publicados somente em `127.0.0.1`; PostgreSQL continua sem porta no host;
- install, update, health e uninstall resolvem o provider pelo estado persistente;
- `legacy-docker-nginx` foi classificado como descontinuado e nunca é selecionado automaticamente.

### Segurança

- resolução transitiva de `brace-expansion` fixada em `1.1.17`; a auditoria local não reporta vulnerabilidades conhecidas;

### Homologação

- nenhuma instalação ou migração real foi executada nesta etapa;
- `--check`, `--dry-run`, emissão/renovação TLS, troca de portas e rollback induzido permanecem pendentes na VPS;
- esta versão alpha não está aprovada para produção.

## [0.3.3-alpha] - 2026-08-02

### Corrigido

- `FULLPASSWORD_COMPOSE_FILE` e demais estados de descoberta passam a ser inicializados antes de qualquer função sob `set -u`;
- o Compose original é descoberto pela label `com.docker.compose.project.config_files`, normalizado pelo working directory e validado, com fallback controlado para `/opt/fullpassword/docker-compose.yml`;
- caminhos ausentes, relativos sem base, inexistentes ou não legíveis produzem bloqueio funcional e relatório sanitizado, nunca erro interno do Bash;
- descoberta de Compose, validação do caminho, inventário de inputs protegidos e merge possuem contratos separados e parâmetros explícitos;
- trap `ERR` registra apenas script, linha, função, código e operação lógica, sem ambiente ou segredos.

### Testes

- 20 cenários de descoberta do Compose, incluindo variável ausente, labels, fallback, múltiplos arquivos, espaços, root simulado e regressão `unbound variable`;
- auditoria de inicialização e modo estrito em sete entrypoints e na biblioteca operacional herdada;
- homologação do novo dry-run comum e privilegiado permanece pendente na VPS.

## [0.3.2-alpha] - 2026-08-02

### Corrigido

- diagnóstico comum distingue inputs protegidos do Compose de incompatibilidade entre diretórios;
- `--check` retorna `passed-with-privileged-dry-run-required` sem falhar quando a validação completa exige root;
- `--dry-run` comum encerra sem alterações, informa o arquivo protegido e apresenta o comando privilegiado completo;
- `sudo --dry-run` usa `--project-directory /opt/fullpassword`, consome o `.env` somente pelo Docker Compose e mantém toda saída interpolada em temporário `0700`;
- merge estrutural preserva serviços, imagens, restart, ambiente, portas, mounts, volumes e redes originais;
- saída e erros do Compose são reduzidos a resultados derivados, sem valores sensíveis;
- temporários são removidos em sucesso, erro e sinais, e a auditoria bloqueia leitura direta, cópia ou mutação de `/opt/fullpassword/.env`.

### Testes

- 20 cenários automatizados para inputs Compose protegidos, privilégios, sanitização, separação de modos e limpeza;
- homologação real de `sudo --dry-run` permanece pendente na VPS; o modo compartilhado não está aprovado para produção.

## [0.3.1-alpha] - 2026-08-02

### Corrigido

- todos os artefatos do adaptador compartilhado foram centralizados em `/opt/devflow`;
- o override Compose passou para `/opt/devflow/config/proxy/fullpassword-nginx.override.yml`, com mounts de origem absoluta;
- `/opt/fullpassword` passou a ser tratado estritamente como origem somente leitura do Compose e da configuração runtime;
- diagnóstico ampliado com legibilidade da origem, gravabilidade do DevFlow, comando e resultado sanitizado do merge entre diretórios;
- `--dry-run` avalia a capacidade do filesystem para a futura instalação root sem tentar escrever em `/opt`;
- estado operacional em JSON separado de dados persistentes: instalação, versão e adaptador em `/opt/devflow/state`;
- retomada de instalação inicial incompleta por fast-forward verificado do checkout preservado em `/opt/devflow/source`;
- testes transacionais e auditoria estática agora falham diante de comandos de escrita destinados ao Full Password.

### Homologação

- validações locais cobrem contrato, merge modelado, rollback e preservação da fixture read-only;
- `--check`, `--dry-run` e instalação compartilhada real permanecem pendentes na VPS Linux; esta versão não está aprovada para produção.

## [0.3.0-alpha] - 2026-07-31

### Adicionado

- adaptador persistente e independente para o contrato comprovado do `fullpassword_nginx`;
- Compose override gerenciado de forma independente (caminho substituído em `0.3.1-alpha`), sem modificar o Compose original;
- virtual host exclusivo em `/opt/devflow/config/nginx/devflow.conf` e templates separados para ACME, operação e manutenção;
- rede externa persistente `devflow_edge`, com aliases exclusivos para frontend e backend e PostgreSQL restrito à rede interna;
- validação fail-closed do merge do Compose, preservando portas, mounts, redes e definições originais;
- prova HTTP da rota ACME antes da emissão do certificado de `dev.sti1.com.br`;
- validação de Nginx em container descartável conectado às redes originais e DevFlow;
- testes transacionais de instalação, repetição, reinstalação, atualização, falhas, rollback e desinstalação.

### Alterado

- o diagnóstico read-only pode retornar `compatible-with-compose-override` somente para o inventário exato aprovado;
- instalação, health check, atualização e desinstalação reconhecem explicitamente `DEVFLOW_SHARED_PROXY_ADAPTER=fullpassword-nginx`;
- o atualizador preserva ou cria transacionalmente a rede externa ao migrar instalações anteriores;
- a desinstalação remove apenas o override, o virtual host e a conexão de borda gerenciados; o certificado DevFlow exige opção e confirmação próprias.

### Segurança

- `/opt/fullpassword/docker-compose.yml`, `docker/nginx.runtime.conf`, volumes, certificados e repositório do Full Password permanecem fora de escrita;
- somente o serviço `nginx` é recriado com os dois arquivos Compose; dependências e containers de terceiros não são recriados;
- qualquer falha de ACME, certificado, merge, `nginx -t`, recriação ou health de qualquer domínio restaura o snapshot anterior;
- o suporte permanece alpha e não homologado até os ensaios reais de Docker, Nginx, certificado, rede e rollback na VPS.

## [0.2.0-alpha] - 2026-07-31

### Adicionado

- diagnóstico sanitizado e somente leitura de proxy compartilhado, com inventário de containers, mounts, redes, configuração efetiva, certificados e mecanismo de reload;
- rede de borda `devflow_edge` separada da rede interna do PostgreSQL;
- testes automatizados da política compartilhada e das transações de configuração Nginx;
- bootstrap público standalone com download seguro, checkout temporário, validação de origem, commit e `VERSION`;
- auditoria automatizada de todos os commits, objetos e blobs alcançáveis do histórico Git;
- atualização segura por release imutável, com consulta da versão disponível na `main` do GitHub;
- exibição de versão instalada, versão disponível e changelog antes da confirmação;
- backup autenticado e validado como gate obrigatório da atualização;
- modo de manutenção para proxy isolado e Nginx compartilhado;
- migrations sob lock, reconstrução controlada dos containers e health checks em camadas;
- rollback automático com restauração do backup, retorno da release e dos containers anteriores;
- logs e relatório sanitizados de atualização;
- `scripts/version.sh` para identificação de versão e commit;
- `scripts/health.sh` para diagnóstico operacional com código de saída confiável.

### Alterado

- modos isolado e compartilhado passam a explicar explicitamente que containers, volumes, banco e storage do DevFlow permanecem próprios;
- promoção e remoção do arquivo exclusivo `devflow.conf` passam a ser atômicas, com backup e rollback também em falha de reload;
- instalação e atualização passam a utilizar HTTPS público sem credenciais na VPS;
- relatório inicial registra versão, commit, branch, data, URL do repositório e canal de atualização;
- `install.sh` passa a tratar exclusivamente instalação inicial;
- a configuração instalada registra o checkout operacional usado para buscar atualizações;
- o restore oferece um modo interno controlado para rollback, sem iniciar serviços prematuramente.

### Segurança

- `fullpassword_nginx`, Nginx containerizado e Caddy permanecem bloqueados após diagnóstico enquanto a integração persistente não for comprovada;
- o ensaio real do commit `4d350685cbc9d21b49fb4c01176b846ca66d6584` foi interrompido antes de qualquer alteração no Full Password;
- abertura pública condicionada à auditoria do checkout e do histórico, sem licença escolhida automaticamente;
- atualização restrita ao repositório `trinityrrocha/DevFlow`, branch `main`, fast-forward e checkout limpo;
- lock exclusivo impede atualizações concorrentes;
- falhas anteriores à primeira mutação preservam o estado intacto; falhas posteriores acionam manutenção e recuperação automática.

## [0.1.0-alpha] - 2026-07-31

### Adicionado

- baseline arquitetural, funcional e multi-tenant dos Documentos 001, 002 e 003;
- backend, frontend, migration inicial e infraestrutura Docker Compose;
- instalador de VPS, diagnóstico, backup, restauração e desinstalação segura;
- publicação inicial privada para homologação.
