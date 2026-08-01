# Instalação em VPS Linux para homologação

> O DevFlow 0.2.0-alpha não está aprovado para produção. Este procedimento é exclusivo para homologação.

## 1. Pré-requisitos

- Ubuntu 22.04/24.04 ou Debian 12/13, `amd64` ou `arm64`;
- 2 GiB de RAM e 5 GiB livres, no mínimo;
- usuário com `sudo`;
- domínio exclusivo resolvendo para a VPS;
- acesso autenticado ao repositório privado;
- snapshot da VPS recomendado antes do primeiro ensaio.

O instalador suporta Docker Engine 24+ e Compose v2 2.20+. Ele não altera firewall, não executa `docker system prune`, não reinicia containers de terceiros e não remove Docker globalmente.

## 2. Clonagem privada

Prefira uma chave SSH pessoal ou deploy key somente leitura:

```bash
git clone git@github.com:trinityrrocha/DevFlow.git
cd DevFlow
git remote -v
git branch --show-current
git rev-parse HEAD
```

Alternativamente, autentique o GitHub CLI no servidor com o fluxo interativo e execute `gh repo clone trinityrrocha/DevFlow`. Não coloque token em URL, shell history, arquivo `.env` ou documentação.

Essa cópia serve apenas para a instalação inicial. O instalador exige `main` limpa e exatamente igual a `origin/main`; depois cria uma cópia operacional root-only em `/opt/devflow/source`. A VPS nunca deve receber commits.

## 3. Diagnóstico e plano

```bash
./install.sh --check
```

Sem argumentos, o resultado é o mesmo. Esse modo lê SO, arquitetura, capacidade, Docker, Compose, portas, containers e colisões conhecidas; não requer `root` e não altera o host.

Escolha explicitamente o proxy e valide o plano:

```bash
./install.sh --dry-run \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Troque `isolated` por `shared` apenas se o Nginx do host for o ingress escolhido. O modo compartilhado não é inferido automaticamente.

## 4. Cenário A — VPS limpa

Confirme que 80/443 estão livres e execute:

```bash
sudo ./install.sh --install \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Após a confirmação literal, o instalador:

1. instala Docker/Compose pelo repositório oficial apenas se ausentes;
2. instala Certbot se necessário;
3. cria `/opt/devflow` com permissões restritivas;
4. arquiva o commit Git em `/opt/devflow/releases/<sha>`;
5. cria `/opt/devflow/source`, checkout operacional root-only com hooks desabilitados;
6. gera a configuração privada e segredos com OpenSSL;
7. inicia PostgreSQL e espera `healthy`;
8. executa `001_initial_schema.sql` pelo migrador com advisory lock;
9. consulta `schema_migrations` no PostgreSQL;
10. emite o certificado do domínio;
11. inicia backend, frontend e edge e espera os healthchecks;
12. valida frontend e `/api/health` por HTTPS;
13. habilita o timer de backup e grava relatório sanitizado.

O instalador não aceita checkout sujo nem origem sem commit Git. Isso impede uma release local não reproduzível.

## 5. Cenário B — Docker e Nginx existentes

Use portas loopback exclusivas e o proxy compartilhado:

```bash
./install.sh --dry-run \
  --proxy-mode shared \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com \
  --http-port 18080 \
  --api-port 13000

sudo ./install.sh --install \
  --proxy-mode shared \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com \
  --http-port 18080 \
  --api-port 13000
```

O instalador cria somente `/etc/nginx/conf.d/devflow.conf`. Se esse caminho existir sem o marcador DevFlow, ele para. Toda candidata passa por `nginx -t`; em falha, o arquivo anterior é restaurado. O reload ocorre somente depois da validação.

Se o Nginx existente não inclui `/etc/nginx/conf.d/*.conf`, prepare um include persistente e documentado antes de executar o instalador. Não modifique arquivos de outra aplicação.

## 6. Coexistência com Full Password

Se existir um container chamado `fullpassword_nginx`, a instalação para antes de qualquer integração. A baseline não usa `docker cp`, não conecta redes no container vizinho, não altera certificado e não executa reload nele.

Para coexistir com segurança, o administrador da VPS deve preparar fora do container um ponto persistente que satisfaça todos estes gates:

- arquivo de configuração versionado em volume do proprietário do proxy;
- domínio, upstream e certificado exclusivos;
- rede compartilhada criada e governada pelo proprietário do proxy;
- teste de configuração no ingress real;
- reload documentado e reversível;
- probes do Full Password antes e depois;
- rollback do arquivo DevFlow sem reiniciar o Full Password.

Depois disso, a integração deve ser feita manualmente ou por um adaptador aprovado em fase posterior. Nunca improvise alteração dentro do container.

## 7. Diretórios e persistência

```text
/opt/devflow/
├── app -> releases/<sha>
├── config/
│   ├── devflow.env          # 0600
│   ├── backup.passphrase    # 0600
│   └── bootstrap-token      # 0600
├── data/postgres/           # persistente
├── backups/                 # persistente
├── logs/                    # sanitizado
├── source/                  # checkout operacional root-only
├── storage/uploads/         # persistente
└── releases/                # releases imutáveis
```

Não use `chmod 777`. Os containers executam com os usuários definidos nas imagens; não é criado usuário Linux adicional nesta baseline.

## 8. Primeiro acesso

Leia o token sem copiá-lo para logs:

```bash
sudo -i
cd /opt/devflow/config
# abra bootstrap-token diretamente em um terminal protegido
```

Use o e-mail informado na instalação, defina uma senha forte e configure MFA. O backend restringe as demais rotas enquanto a troca de senha ou o cadastro de MFA estiver pendente. Depois de confirmar o bootstrap, remova o token:

```bash
sudo rm -- /opt/devflow/config/bootstrap-token
```

## 9. SMTP e domínio

Edite somente o arquivo privado:

```bash
sudoedit /opt/devflow/config/devflow.env
sudo chmod 600 /opt/devflow/config/devflow.env
```

Defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`. Nunca mostre o arquivo completo em ticket ou diagnóstico. O domínio não pode ser compartilhado com outro virtual host.

## 10. Verificação

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
curl --fail --silent https://devflow.exemplo.com/api/health
curl --fail --silent https://devflow.exemplo.com/
```

O relatório da instalação fica em `/opt/devflow/data/install-report.txt`. A conclusão exige `healthy`, não apenas `running`.

## 11. Atualização, remoção e recuperação

Antes do primeiro update, forneça a `root` uma credencial GitHub somente leitura. A opção preferida é uma deploy key exclusiva de `trinityrrocha/DevFlow`, cadastrada sem permissão de escrita. Guarde a chave privada como `/root/.ssh/devflow_deploy`, modo `0600`, verifique o host `github.com` por fingerprint oficial e vincule-a somente ao checkout:

```bash
sudo git -C /opt/devflow/source config --local core.sshCommand \
  'ssh -i /root/.ssh/devflow_deploy -o IdentitiesOnly=yes'
sudo GIT_TERMINAL_PROMPT=0 git -C /opt/devflow/source fetch origin main
```

Não cole a chave privada ou token em comandos, logs, `.env` ou URLs. A publicação continua ocorrendo exclusivamente no Windows pela conta `trinityrrocha`; a credencial da VPS é somente leitura.

```bash
sudo /opt/devflow/app/scripts/version.sh --all --refresh
sudo /opt/devflow/app/scripts/update.sh --check
sudo /opt/devflow/app/scripts/update.sh
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
sudo /opt/devflow/app/scripts/uninstall.sh --purge
```

O updater aceita apenas remote `trinityrrocha/DevFlow`, branch `main`, checkout limpo e fast-forward. Ele exibe a versão e o changelog antes da confirmação, cria e verifica backup, mantém HTTP 503 durante a troca e restaura automaticamente a versão anterior em falha. Consulte o [runbook operacional](update-backup-rollback.md).

`--keep-data` preserva configuração, banco, storage, backups, releases e o checkout operacional. `--purge` exige backup existente, lista o alvo e pede duas confirmações literais. A deploy key em `/root/.ssh` não é removida automaticamente. Docker, certificados e Full Password são sempre preservados.

## 12. Limitações da alpha

- sem interface web administrativa para o updater;
- rollback automático implementado, mas ainda sem fault-injection e restore drill na VPS;
- sem laboratório publicado de coexistência com `fullpassword_nginx`;
- sem prova de renovação automática do certificado;
- sem matriz completa de distribuição/arquitetura em CI;
- sem teste E2E, restore drill, pentest ou aprovação para produção.
