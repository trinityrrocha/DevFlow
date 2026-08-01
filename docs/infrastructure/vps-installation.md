# Instalação em VPS Linux para homologação

> O DevFlow 0.1.0-alpha não está aprovado para produção. Este procedimento é exclusivo para homologação.

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
5. gera a configuração privada e segredos com OpenSSL;
6. inicia PostgreSQL e espera `healthy`;
7. executa `001_initial_schema.sql` pelo migrador com advisory lock;
8. consulta `schema_migrations` no PostgreSQL;
9. emite o certificado do domínio;
10. inicia backend, frontend e edge e espera os healthchecks;
11. valida frontend e `/api/health` por HTTPS;
12. habilita o timer de backup e grava relatório sanitizado.

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

```bash
cd /caminho/do/checkout/DevFlow
sudo ./scripts/update.sh
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
sudo /opt/devflow/app/scripts/uninstall.sh --purge
```

`--update` aceita apenas remote `trinityrrocha/DevFlow`, branch `main`, checkout limpo e fast-forward. Ele cria e verifica backup antes de migrations. O rollback transacional completo ainda não existe; consulte o [runbook operacional](update-backup-rollback.md).

`--keep-data` preserva configuração, banco, storage, backups e releases. `--purge` exige backup existente, lista o alvo e pede duas confirmações literais. Docker, certificados e Full Password são sempre preservados.

## 12. Limitações da alpha

- sem WebUpdater definitivo;
- sem rollback automático completo após migration;
- sem laboratório publicado de coexistência com `fullpassword_nginx`;
- sem prova de renovação automática do certificado;
- sem matriz completa de distribuição/arquitetura em CI;
- sem teste E2E, restore drill, pentest ou aprovação para produção.
