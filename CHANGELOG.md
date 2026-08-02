# Changelog

Todas as alterações relevantes do DevFlow são registradas neste arquivo.

## [0.3.1-alpha] - 2026-08-02

### Corrigido

- todos os artefatos do adaptador compartilhado foram centralizados em `/opt/devflow`;
- o override Compose passou para `/opt/devflow/config/proxy/fullpassword-nginx.override.yml`, com mounts de origem absoluta;
- `/opt/fullpassword` passou a ser tratado estritamente como origem somente leitura do Compose e da configuração runtime;
- diagnóstico ampliado com legibilidade da origem, gravabilidade do DevFlow, comando e resultado sanitizado do merge entre diretórios;
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
