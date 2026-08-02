# Contratos de variáveis Bash

Os scripts operacionais mantêm `set -Eeuo pipefail`. Variáveis não são tornadas opcionais apenas para evitar `set -u`; cada uso pertence a uma das categorias abaixo.

| Categoria | Contrato |
|---|---|
| Obrigatória | argumento de função validado com `${n:?mensagem}` somente depois de o chamador comprovar o valor; domínio, e-mails e modo de instalação são validados antes do plano |
| Opcional | inicializada no topo com vazio ou default seguro e testada antes do uso |
| Descoberta | inicializada com estado desconhecido/false, preenchida por uma função dedicada e acompanhada por flags de detecção, existência e legibilidade |
| Derivada | `local` inicializada na própria função a partir de entradas já validadas |
| Secreta | carregada exclusivamente do ambiente privado quando a operação efetiva exige; nunca incluída no diagnóstico compartilhado |
| Somente leitura | caminho ou metadado usado apenas para inspeção; nenhuma função diagnóstica recebe autorização de escrita no Full Password |

## Classificação por fluxo

| Script | Obrigatórias | Opcionais | Descobertas/derivadas | Secretas | Somente leitura |
|---|---|---|---|---|---|
| `detect-shared-proxy.sh` | parâmetros internos de merge após validação | domínio, e-mails, portas, container, output | projeto, serviço, working directory, config files, Compose, diretório e `.env` | nenhuma | Compose, runtime Nginx, labels, mounts, redes e certificados Full Password |
| `install.sh` | domínio, e-mails e proxy em `--install` | modo/check, portas e confirmação do bootstrap | Docker, Compose, proxy, conflitos e plano | segredos gerados e `devflow.env` somente após o gate de instalação | infraestrutura existente durante check/dry-run |
| `bootstrap.sh` | ref, versão esperada e remote canônico | modo e parâmetros encaminhados | checkout, commit e versão remotos | nenhuma | bootstrap baixado e checkout temporário |
| `lib/fullpassword-proxy.sh` | Compose/override somente após preflight | domínio original e temporários | snapshot, rede, health e rollback | nenhuma do Full Password | `/opt/fullpassword`, certificados e estado do container |
| `update.sh` | instalação existente, release e backup válidos | `--check` e confirmação | versões, SHAs, candidato, manutenção e rollback | configuração privada carregada sem log | checkout Git e release anterior |
| `uninstall.sh` | modo explícito | preservação, purge e certificado | inventário de recursos gerenciados | configuração privada quando necessária | recursos de terceiros e Full Password |
| `health.sh` | configuração instalada | modo interno/quiet e versão pendente | containers, migrations, redes e endpoints | valores usados apenas pelos comandos Compose/PostgreSQL | proxy e Full Password |
| `diagnose.sh` | instalação identificável | arquivo de saída | versões, containers, redes, volumes e logs sanitizados | nenhuma saída secreta | configuração e runtime |

`scripts/audit-bash-initialization.mjs` verifica modo estrito nos sete entrypoints, confirma que a biblioteca `fullpassword-proxy.sh` herda esse modo de seus chamadores, proíbe `set +u`, executa `bash -n`, cruza referências não protegidas com atribuições, dependências carregadas e contratos externos, exige inicialização global das variáveis críticas de descoberta e possui autoteste negativo para regressões semelhantes a `FULLPASSWORD_COMPOSE_FILE`.
