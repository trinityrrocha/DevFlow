# Migração controlada para Nginx no host

> Procedimento alpha, ainda não homologado na VPS. Não execute `--migrate` ou `--rollback` sem janela aprovada, snapshot externo e plano de contingência.

O utilitário `scripts/migrate-proxy-to-host-nginx.sh` prepara a transição de `fullpassword_nginx:80/443` para Nginx central no host. Ele não é chamado por `install.sh` e não altera o repositório, Compose original, banco, volumes ou código do Full Password.

## Diagnóstico permitido nesta fase

```bash
cd DevFlow
sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
sudo ./scripts/migrate-proxy-to-host-nginx.sh --dry-run
```

`--check` não persiste arquivos. `--dry-run` também não altera infraestrutura: ele cria apenas o relatório sanitizado `/var/log/devflow/proxy-migration-dry-run.log` (modo `0640`). Nenhum dos modos instala pacotes, altera portas, inicia/recarrega Nginx ou recria containers.

Os dois modos geram artefatos somente dentro de um diretório temporário `0700`, executam o Compose original e o merge real com `config --format json` e eliminam esses JSONs no trap. A saída contém apenas fatos derivados. O conteúdo de `.env`, environment interpolado, tokens, cookies, chaves e dados pessoais não é exibido nem gravado.

O resultado apresenta:

- bindings reais de `fullpassword_nginx`;
- conflitos de sockets, Docker, containers, systemd e configuração em `127.0.0.1:18081`;
- preservação de serviços, mounts, redes, environment e restart no merge;
- validade do Compose original como fonte de rollback para 80/443;
- estado do binário, serviço, enable, processos e listeners do Nginx do host;
- validade isolada do vhost planejado, sem bind, start ou reload;
- saúde HTTP, HTTPS, certificado, frontend e `/api/health` do Full Password;
- sequência de rollback e blockers allowlisted.

`migration_ready=true` exige todos os gates aplicáveis; uma resposta genérica `ready` não é usada. Durante o dry-run, `planned_upstream_runtime_test=not-executed` e `reason=migration-not-applied` são intencionais: a publicação atual não é modificada.

## Transação futura

A estratégia mantém o proxy interno do Full Password e muda somente sua publicação para `127.0.0.1:18081 -> 80`, usando override externo em `/etc/devflow/proxy-migrations/fullpassword-host-nginx.override.yml`. O Compose original permanece intocado. Compose v2 `2.24.4+` é exigido para a semântica `!override`.

Antes da mutação, o utilitário comprova identidade/labels do container, mappings atuais, porta loopback livre, `nginx -t`, certificado, saúde pública, Compose original e Compose combinado. Depois exige as confirmações literais `SNAPSHOT CONFIRMADO` e `MIGRAR PROXY PUBLICO`, captura hashes/inspect sanitizado, prepara o virtual host e recria somente o serviço `nginx` com `--no-deps`.

A ordem codificada para uma futura janela é:

1. parar o Nginx do host sem tocar em terceiros;
2. recriar somente `fullpassword_nginx` em loopback;
3. validar frontend, `/api/health` e a fronteira não autenticada em `/api/auth/me` pelo loopback;
4. comprovar que 80/443 ficaram livres;
5. iniciar o Nginx do host somente depois dos probes de loopback;
6. confirmar ownership dos listeners e saúde pública.

O instalador comum continua sem responsabilidade por essa migração.

## Rollback

Em falha após a troca, o trap para o Nginx do host, confirma a liberação de 80/443, remove somente a rota marcada, recria `fullpassword_nginx` com o Compose original, confirma os mappings públicos, valida Nginx, frontend e API e registra o resultado. Falhas anteriores à troca não acionam rollback desnecessário. Zero downtime não é prometido; início e fim da janela são registrados.

O rollback manual é recusado se o DevFlow já estiver instalado no Nginx central, pois desligar o proxy global afetaria outro projeto. A estratégia direta aos serviços internos do Full Password permanece fora desta versão.
