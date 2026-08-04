# Contratos de variaveis Bash

| Componente | Entradas permitidas | Estado persistente | Mutacao autorizada |
|---|---|---|---|
| `bootstrap.sh` | modo, dominio, e-mail, versao esperada | nenhuma | checkout temporario validado |
| `install.sh` | modo, dominio, e-mail | transacao e estado v3 | somente recursos DevFlow |
| `update.sh` | check, versao esperada, rollback | transacao de update | release, backup e containers DevFlow |
| `health.sh` | internal, quiet | nenhuma | nenhuma |
| `uninstall.sh` | keep-data, purge | nenhuma | somente alvos DevFlow confirmados |

O arquivo `devflow.env` nao e executado. `load_devflow_env` aceita apenas chaves allowlisted e exporta valores como dados. Caminhos persistentes devem resolver exatamente sob `/opt/devflow`.
