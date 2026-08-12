# Contrato de permissoes da fila operacional

## Causa confirmada

O updater executa como root, enquanto o backend executa como usuario `devflow` non-root. Na instalacao 0.6.28, o daemon aplicava `umask 077`, alterava a raiz para `100:100 0700` e o status nascia `root:root 0600`. Um backend com `uid=100`, `gid=101` nao possui a permissao de leitura de grupo nem de terceiros; o resultado e `EACCES`, convertido pela API em HTTP 503.

## Autoridade do GID

Em instalacoes novas, `scripts/install.sh` cria o grupo host `devflow-ops` com `groupadd --system`, deixando o sistema escolher um GID livre. O GID obtido por `getent` e persistido como `DEVFLOW_OPS_GID` no arquivo privado. Um valor existente so e aceito se nao conflitar com outro grupo.

O Compose inclui esse numero, e nao o nome, em `group_add` de `backend` e `updater`. Assim o contrato nao depende do banco de nomes dentro das imagens. Para a transicao da 0.6.28, onde a variavel ainda nao existe, o escritor executado pelo updater deriva o GID do usuario `devflow` no container backend em execucao. Se o backend estiver no curto periodo de restart, deriva o mesmo GID da imagem de release por um container sem rede e sem volumes; o valor e persistido pelo motor novo no proximo ciclo.

## Matriz minima

| Caminho | Owner/grupo | Modo | Backend | Updater |
|---|---|---:|---|---|
| raiz `updater/` | `root:<ops>` | `2750` | atravessa/le metadados | administra |
| `requests/` | `root:<ops>` | `2770` | cria request | le e move |
| `processing/` | `root:<ops>` | `2750` | le request/status por ID | administra |
| `processed/` | `root:<ops>` | `2750` | le/reconcilia auditoria | administra |
| `failed/` | `root:<ops>` | `2750` | le estado sanitizado | administra |
| `status/` | `root:<ops>` | `2750` | le status | escreve |
| request/status JSON | `root:<ops>` apos consumo | `0640` | le | le/escreve |
| `backup-catalog.json` | `root:<ops>` | `0640` | le | escreve |
| logs e validacoes | `root:root` | `0600` | sem acesso | escreve |

O bit setgid nos diretorios garante heranca do grupo. Nenhum caminho usa `0777`, o backend continua non-root e nao recebe Docker socket.

## Atomicidade e reconciliacao

Status e catalogo sao escritos em arquivo temporario exclusivo, recebem `0640` e o GID operacional, passam por `fsync`, e so entao sao promovidos com `rename`. O diretorio tambem passa por `fsync`.

Na instalacao, no inicio do daemon e antes de cada update, a reconciliacao percorre somente os seguintes allowlists:

- `requests/*.json`, `processing/*.json`, `processed/*.json`, `failed/*.json`;
- `status/*.json`;
- `backup-catalog.json`;
- logs e validacoes apenas para reafirmar `root:root 0600`.

Backups, configuracoes, secrets, anexos e o restante de `/opt/devflow` nao sao alterados. O escritor da release nova repete essa reconciliacao restrita para permitir que o proprio ciclo 0.6.28 → 0.6.29 corrija artefatos antigos antes de publicar o status terminal.

## Full Password

O Full Password no commit de referencia usa uma fila simples privada e `umask 077`. Esse conceito continua sendo a base do daemon, mas nao pode ser copiado literalmente: no DevFlow o backend consulta status e catalogo gerados pelo updater. Por isso foi acrescentado somente o compartilhamento controlado por GID, mantendo logs privados.

## Observacao sobre `/api/auth/me`

O HTTP 401 observado nao foi reproduzido como efeito do filesystem. A rota devolve 401 quando o cookie esta ausente ou quando `validateSession` considera a sessao encerrada/expirada; o frontend emite `devflow:session-expired`. Nao foi criada nenhuma relacao artificial entre esse comportamento e o `EACCES` operacional.
