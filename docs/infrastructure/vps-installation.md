# Instalação em VPS Linux para homologação

> O DevFlow 0.2.0-alpha não está aprovado para produção. Este procedimento é exclusivo para homologação.

## 1. Pré-requisitos

- Ubuntu 22.04/24.04 ou Debian 12/13, `amd64` ou `arm64`;
- 2 GiB de RAM e 5 GiB livres, no mínimo;
- usuário com `sudo`;
- domínio exclusivo resolvendo para a VPS;
- conectividade HTTPS com `github.com` e `raw.githubusercontent.com`;
- snapshot da VPS recomendado antes do primeiro ensaio.

O instalador suporta Docker Engine 24+ e Compose v2 2.20+. Ele não altera firewall, não executa `docker system prune`, não reinicia containers de terceiros e não remove Docker globalmente.

## 2. Bootstrap público

Não use `curl | bash` ou `wget | bash`. Baixe o bootstrap, revise o arquivo e execute separadamente:

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
less install.sh
```

O bootstrap é independente de checkout anterior. Ele valida Linux, conectividade e dependências; somente após a confirmação de instalação pode instalar Git ausente pelos pacotes da distribuição. O checkout temporário usa HTTPS público e é removido ao sair.

Não são necessários token, GitHub CLI, deploy key ou chave SSH. A VPS nunca deve receber commits.

## 3. Diagnóstico e plano

```bash
./install.sh --check
```

Esse modo cria somente um checkout temporário, comprova remote, branch, commit e `VERSION`, chama o diagnóstico interno e remove os temporários. Não requer `root` nem altera a instalação.

Escolha explicitamente o proxy e valide o plano:

```bash
./install.sh --dry-run \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Troque `isolated` por `shared` somente quando já existir um proxy. O modo compartilhado não é inferido automaticamente e não compartilha containers, volumes, banco ou storage. A integração automática desta versão é limitada ao Nginx do host; Caddy e proxies containerizados são somente diagnosticados e bloqueados.

Também é possível executar `sudo ./install.sh` sem argumentos. Nesse caso, o bootstrap pergunta domínio, e-mails, modo de proxy e confirmação antes de qualquer mudança permanente.

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

O relatório registra data, versão, commit, branch, URL pública do repositório e canal de atualização.

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

Antes do plano, o instalador pede autorização específica para executar um diagnóstico somente leitura. O relatório sanitizado é salvo em `/var/log/devflow/shared-proxy-diagnostic.log` e registra tipo, container, imagem, status, health, portas, redes, mounts, includes, certificados, reload, compatibilidade e bloqueios. Nenhuma chave, senha, token ou conteúdo do ambiente é coletado.

Somente um Nginx do host é aceito automaticamente, e apenas quando `nginx -t`, include persistente de `/etc/nginx/conf.d/*.conf`, mecanismo de certificado, reload, domínio e portas forem comprovados. O instalador cria exclusivamente `/etc/nginx/conf.d/devflow.conf`. Durante ACME, apenas o challenge é servido e todo o restante responde `503`; o proxy da aplicação só é publicado depois dos health checks internos. A aplicação é atômica, guarda backup em `/opt/devflow/backups/proxy`, valida antes e depois, e restaura o arquivo anterior inclusive quando o reload falha.

Se o Nginx existente não inclui `/etc/nginx/conf.d/*.conf`, prepare um include persistente e documentado antes de executar o instalador. Não modifique arquivos de outra aplicação.

## 6. Coexistência com Full Password

Se existir um container chamado `fullpassword_nginx`, o instalador oferece o diagnóstico read-only e depois mantém a instalação bloqueada. A baseline não usa `docker cp`, não conecta redes no container vizinho, não altera certificado e não executa reload nele.

O primeiro ensaio real ocorreu com o commit `4d350685cbc9d21b49fb4c01176b846ca66d6584`, versão `0.2.0-alpha`. O bootstrap funcionou e a detecção de `fullpassword_nginx` interrompeu o fluxo antes de qualquer integração insegura. Isso não representa instalação aprovada nem homologação do modo compartilhado.

Para repetir somente o inventário a partir de um checkout confiável:

```bash
sudo ./scripts/detect-shared-proxy.sh \
  --container fullpassword_nginx \
  --domain devflow.exemplo.com \
  --output /var/log/devflow/shared-proxy-diagnostic.log
```

O código de saída `2` significa que a compatibilidade não foi comprovada; não desabilite esse gate.

Para coexistir com segurança, o administrador da VPS deve preparar fora do container um ponto persistente que satisfaça todos estes gates:

- arquivo de configuração versionado em volume do proprietário do proxy;
- domínio, upstream e certificado exclusivos;
- rede compartilhada criada e governada pelo proprietário do proxy;
- teste de configuração no ingress real;
- reload documentado e reversível;
- probes do Full Password antes e depois;
- rollback do arquivo DevFlow sem reiniciar o Full Password.

Depois disso, o relatório deve ser analisado e um adaptador específico implementado e testado em fase posterior. Não improvise alteração manual dentro do container.

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

O checkout `/opt/devflow/source` usa exclusivamente `https://github.com/trinityrrocha/DevFlow.git`. Como o repositório é público, consultas e atualizações não dependem de credenciais. Não configure token, chave SSH, deploy key ou credential helper para o DevFlow na VPS.

```bash
sudo /opt/devflow/app/scripts/version.sh --all --refresh
sudo /opt/devflow/app/scripts/update.sh --check
sudo /opt/devflow/app/scripts/update.sh
sudo /opt/devflow/app/scripts/uninstall.sh --keep-data
sudo /opt/devflow/app/scripts/uninstall.sh --purge
```

O updater aceita apenas remote `trinityrrocha/DevFlow`, branch `main`, checkout limpo e fast-forward. Ele exibe a versão e o changelog antes da confirmação, cria e verifica backup, mantém HTTP 503 durante a troca e restaura automaticamente a versão anterior em falha. Consulte o [runbook operacional](update-backup-rollback.md).

`--keep-data` preserva configuração, banco, storage, backups, releases e o checkout operacional. `--purge` exige backup existente, lista o alvo e pede duas confirmações literais. Docker, certificados e Full Password são sempre preservados.

## 12. Limitações da alpha

- sem interface web administrativa para o updater;
- rollback automático implementado, mas ainda sem fault-injection e restore drill na VPS;
- sem laboratório publicado de coexistência com `fullpassword_nginx`;
- integração automática com Caddy e Nginx containerizado ainda indisponível;
- sem prova de renovação automática do certificado;
- sem matriz completa de distribuição/arquitetura em CI;
- sem teste E2E, restore drill, pentest ou aprovação para produção.
