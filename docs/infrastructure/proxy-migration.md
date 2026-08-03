# Migração controlada para Nginx no host

> Procedimento alpha, ainda não homologado na VPS. Não execute `--migrate` ou `--rollback` sem janela aprovada, snapshot externo e plano de contingência.

O utilitário `scripts/migrate-proxy-to-host-nginx.sh` prepara a transição de `fullpassword_nginx:80/443` para Nginx central no host. Ele não é chamado por `install.sh` e não altera o repositório, Compose original, banco, volumes ou código do Full Password.

## Diagnóstico permitido nesta fase

```bash
cd DevFlow
sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
sudo ./scripts/migrate-proxy-to-host-nginx.sh --dry-run
```

Ambos são somente leitura: não criam diretórios, não instalam pacotes, não fazem reload e não recriam containers.

## Transação futura

A estratégia inicial mantém o proxy interno do Full Password e muda somente sua publicação para `127.0.0.1:18081 -> 80`, usando override externo em `/etc/devflow/proxy-migrations/fullpassword-host-nginx.override.yml`. O Compose original permanece intocado. Compose v2 `2.24.4+` é exigido para a semântica `!override`.

Antes da mutação, o utilitário comprova identidade/labels do container, portas atuais, `nginx -t`, certificado, health público e Compose combinado. Depois exige as confirmações literais `SNAPSHOT CONFIRMADO` e `MIGRAR PROXY PUBLICO`, captura hashes/inspect sanitizado, prepara o virtual host e recria somente o serviço `nginx` com `--no-deps`.

Em falha após a troca, o trap para o Nginx do host, remove somente a rota marcada, recria `fullpassword_nginx` com o Compose original, valida Nginx e HTTPS e registra o resultado. Zero downtime não é prometido; início e fim da janela são registrados.

O rollback manual é recusado se o DevFlow já estiver instalado no Nginx central, pois desligar o proxy global afetaria outro projeto. A estratégia direta aos serviços internos do Full Password permanece fora desta versão.
