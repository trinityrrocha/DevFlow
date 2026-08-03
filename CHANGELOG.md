# Changelog

Todas as alterações relevantes do DevFlow são registradas neste arquivo.

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
