# Host Nginx Provider

O `host-nginx` é o provider padrão do DevFlow `0.4.0-alpha`. Ele instala Nginx e Certbot pelos pacotes oficiais da distribuição suportada quando ausentes e somente após confirmação do instalador. Não depende do Compose, rede, volume ou diretório de outro projeto.

## Recursos gerenciados

Em Debian/Ubuntu, o provider prefere:

```text
/etc/nginx/sites-available/devflow.conf
/etc/nginx/sites-enabled/devflow.conf
```

Quando esse layout não existe, usa `/etc/nginx/conf.d/devflow.conf`. Uma cópia auditável fica em `/opt/devflow/config/nginx/devflow.conf`; backups ficam em `/opt/devflow/backups/proxy`. O hook exclusivo `/etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload` valida `nginx -t` antes do reload.

O provider nunca remove o pacote ou serviço Nginx global. Na desinstalação, remove somente arquivos com marcador DevFlow; o certificado exige a opção e a confirmação separadas já documentadas.

## Aplicação atômica

O arquivo candidato é criado com `mktemp`, validado pelo marcador, promovido por rename, ligado em `sites-enabled`, validado por `nginx -t` e recarregado. Qualquer falha restaura arquivo/link anteriores e tenta validar e recarregar o estado restaurado. Um arquivo sem marcador ou um link para outro destino bloqueia a operação.

## TLS e health

O desafio ACME usa `/opt/devflow/storage/acme`, o certificado é específico ao domínio e validado por `openssl x509 -checkhost`. A instalação habilita o timer do Certbot quando disponível e executa um ensaio de renovação `--dry-run`. Health valida serviço, sintaxe, certificado, Certbot, frontend/API locais e endpoints públicos.

As portas configuráveis `DEVFLOW_HTTP_PORT` e `DEVFLOW_API_PORT` são publicadas somente em `127.0.0.1`. O virtual host aplica TLS 1.2/1.3, CSP, HSTS, proteção de framing/MIME, limites de upload, timeouts e suporte a upgrade de conexão.

## Conflitos

Se 80/443 estiverem ocupadas e o Nginx do host não for o proprietário comprovado, a instalação falha. Quando o proprietário é `fullpassword_nginx`, retorna `migration-required` e orienta o utilitário separado. Nenhuma seleção automática do provider legado ocorre.
