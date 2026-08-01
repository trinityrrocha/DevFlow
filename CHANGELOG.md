# Changelog

Todas as alterações relevantes do DevFlow são registradas neste arquivo.

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
