# Adaptador persistente para `fullpassword_nginx`

> Corrigido em `0.3.2-alpha` para homologação. Ainda não aprovado para produção nem homologado na VPS real.

> O DevFlow é integralmente instalado em `/opt/devflow`. O diretório `/opt/fullpassword` é utilizado somente para leitura do Compose original durante a integração opcional com o proxy compartilhado.

## Contrato aceito

O adaptador opera somente quando o diagnóstico read-only comprova simultaneamente:

- container `fullpassword_nginx`, projeto Compose `fullpassword` e serviço `nginx`;
- working directory `/opt/fullpassword` e Compose original `/opt/fullpassword/docker-compose.yml`;
- bind read-only de `/opt/fullpassword/docker/nginx.runtime.conf` em `/etc/nginx/conf.d/default.conf`;
- bind read-only de `/etc/letsencrypt` no mesmo caminho dentro do container;
- rede original `fullpassword_fullpassword_network`;
- publicação original das portas 80/443 e ausência dos aliases reservados `devflow-backend`/`devflow-frontend` no runtime original;
- include persistente `/etc/nginx/conf.d/*.conf` e `nginx -t` válido;
- domínio DevFlow sem conflito, `/opt/devflow/config/proxy` gravável e rede `devflow_edge` ausente ou pertencente ao DevFlow;
- certificado preexistente, quando houver, específico para o domínio DevFlow e nunca wildcard;
- merge estrutural do Compose válido.

O diagnóstico usa `python3` para comparar o Compose base com o resultado normalizado do merge. Como essa verificação ocorre antes de qualquer mutação, o comando precisa existir previamente na VPS compartilhada. Todos os comandos usam explicitamente `docker compose --project-directory /opt/fullpassword`, preservando a resolução original de `.env`, `env_file` e caminhos relativos.

Os inputs protegidos são opacos. O DevFlow identifica apenas caminho, tipo, existência e legibilidade; não usa `cat`, `source`, `cp`, `chmod` ou `chown` e não interpreta seus valores. O próprio Docker Compose pode consumi-los durante um dry-run executado explicitamente com `sudo`. A configuração JSON interpolada fica exclusivamente em diretório temporário `0700`, com arquivos `0600`, e é removida por trap em sucesso, erro ou sinal. O relatório contém somente fatos estruturais derivados.

O relatório registra `devflow_directory_writable` e `devflow_override_writable` no contexto planejado `root-installation`, verificando filesystem read-write e atributos imutáveis sem criar arquivos. Também registra UID/usuário, modo, necessidade de privilégio, tentativa, bloqueio, `compose_cross_directory_supported`, `compose_merge_valid`, alterações realizadas, prontidão da instalação e os fatos de preservação estrutural. O diagnóstico nunca registra JSON interpolado, conteúdo de ambiente ou valor de variável, nunca cria arquivos em `/opt/fullpassword`; seus candidatos ficam em `/tmp` e o relatório opcional fica em `/opt/devflow/logs`.

Qualquer divergência mantém `compatibility=blocked`. O adaptador não tenta descobrir uma alternativa por tentativa e erro.

## Limites e arquivos

O DevFlow não edita:

- `/opt/fullpassword/docker-compose.yml`;
- `/opt/fullpassword/docker/nginx.runtime.conf`;
- arquivos dentro do container;
- volumes, certificados ou rede interna do Full Password.

Ele gerencia exclusivamente:

```text
/opt/devflow/config/proxy/fullpassword-nginx.override.yml
/opt/devflow/config/nginx/devflow.conf
/opt/devflow/backups/proxy/fullpassword-*/
/opt/devflow/logs/fullpassword-proxy.log
/opt/devflow/state/proxy-adapter.json
/opt/devflow/storage/acme/
devflow_edge
```

Estrutura persistente do adaptador:

```text
/opt/devflow/
├── config/
│   ├── nginx/devflow.conf                 # 0644; conteúdo não secreto
│   └── proxy/fullpassword-nginx.override.yml # 0644; conteúdo não secreto
├── backups/proxy/                         # 0700 por transação
├── logs/                                  # diretório 0750; logs 0640
└── state/
    ├── installation.json                  # 0640
    ├── version.json                       # 0640
    └── proxy-adapter.json                 # 0640
```

Os diretórios do DevFlow usam `0750`; segredos continuam fora desses arquivos, em `/opt/devflow/config/devflow.env` e arquivos de chave com `0600`. O instalador não aplica `chmod`, `chown`, links, backups ou qualquer outra mutação em `/opt/fullpassword`.

O override acrescenta ao serviço `nginx` o mount read-only de `devflow.conf`, o webroot ACME read-only e a rede externa `devflow_edge`. As portas 80/443, os mounts originais e `fullpassword_fullpassword_network` precisam permanecer idênticos após o merge. O validador Python recusa qualquer perda ou alteração.

Frontend e backend recebem aliases `devflow-frontend` e `devflow-backend` em `devflow_edge`. O PostgreSQL nunca participa dessa rede e continua somente em `devflow_internal`.

## Aplicação transacional

1. valida o Full Password e `https://pw.sti1.com.br` antes de qualquer integração;
2. cria um snapshot dos arquivos gerenciados, da existência da rede e do certificado DevFlow;
3. cria `devflow_edge` com labels de propriedade do DevFlow;
4. renderiza candidatos temporários e valida o merge completo do Compose;
5. valida a configuração Nginx em container descartável usando o image ID imutável atual;
6. promove atomicamente o override e o virtual host HTTP/ACME;
7. reconcilia somente `nginx`, com `up -d --no-deps nginx`, e executa `nginx -t`;
8. publica um desafio aleatório e confirma que `dev.sti1.com.br` chega ao webroot correto;
9. emite ou valida somente o certificado `dev.sti1.com.br` com o e-mail informado;
10. promove o virtual host HTTPS, recria apenas `nginx` e valida os dois domínios.

Em qualquer falha, os arquivos anteriores são restaurados, o serviço `nginx` retorna ao Compose anterior, `pw.sti1.com.br` é testado novamente e recursos DevFlow recém-criados são removidos quando estiverem sem uso. Backups transacionais são preservados sem conteúdo de segredos nos logs.

## Operação correta do proxy

Enquanto o adaptador estiver instalado, toda reconciliação do proxy deve usar os dois arquivos:

```bash
docker compose \
  --project-directory /opt/fullpassword \
  -f /opt/fullpassword/docker-compose.yml \
  -f /opt/devflow/config/proxy/fullpassword-nginx.override.yml \
  config

docker compose \
  --project-directory /opt/fullpassword \
  -f /opt/fullpassword/docker-compose.yml \
  -f /opt/devflow/config/proxy/fullpassword-nginx.override.yml \
  up -d --no-deps nginx
```

Executar apenas o Compose original pode remover o mount ou a conexão DevFlow na próxima recriação do proxy. Os scripts do DevFlow sempre usam ambos. Operadores do Full Password devem incorporar o override a seus procedimentos enquanto a coexistência estiver ativa.

## Atualização, health e remoção

O `update.sh` cria snapshot antes de trocar `devflow.conf`, usa o template de manutenção, valida merge/Nginx/domínios e reverte junto com a release e o backup da aplicação. O `health.sh` verifica containers, migration, fronteira de rede, `nginx -t`, `dev.sti1.com.br` e `pw.sti1.com.br`.

A remoção padrão é:

```bash
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
```

Ela remove apenas o override e o virtual host DevFlow, recria `nginx` com o Compose original, confirma o health do Full Password e remove `devflow_edge` somente quando vazia e reconhecidamente gerenciada. Para remover também o certificado DevFlow:

```bash
sudo /opt/devflow/app/scripts/uninstall.sh \
  --keep-data \
  --remove-devflow-certificate
```

A opção pede a confirmação literal `REMOVER CERTIFICADO DEVFLOW`. O certificado do Full Password nunca é alvo.

## Homologação pendente

Os testes locais cobrem merge, preservação, idempotência, instalação, atualização, falhas e rollback com doubles controlados. Permanecem pendentes na VPS: Compose real, redes, emissão/renovação ACME, recriação do Nginx, falhas induzidas, rollback completo e comprovação externa dos dois domínios. Até isso ocorrer, `compatible-with-compose-override` significa compatibilidade estrutural diagnosticada, não homologação operacional.
