# Baseline de seguranca

## Limite isolado

O DevFlow controla somente recursos prefixados ou armazenados em seu namespace: containers `devflow-*`, redes `devflow_edge`/`devflow_internal`, `/opt/devflow`, quatro unidades systemd e locks `devflow-*` em `/run/lock`. Nao executa prune global, nao modifica virtual hosts do host e nao adapta proxies existentes.

## Rede

- somente `devflow-nginx` publica 80/443;
- PostgreSQL nao publica porta e conecta apenas a rede interna;
- frontend conecta apenas a borda;
- backend intermedia borda e rede interna;
- o Certbot standalone do host atua antes do Nginx; o container Nginx recebe `/etc/letsencrypt` somente leitura;
- o updater nao publica portas, valida pedidos HMAC e possui allowlist exclusiva `install-update`.

## Segredos

O ambiente privado, passphrase e token de bootstrap usam modo `0600`. Logs passam por sanitizacao. Segredos sao gerados com OpenSSL, nunca exibidos nem versionados.

## TLS e proxy

Antes da emissao, o instalador compara fontes independentes do IPv4 publico, todos os registros A e exige confirmacao do firewall. O Certbot usa modo standalone com 80/443 livres. A configuracao HTTPS e gerada somente depois de validar validade, dominio/SAN, symlinks sob `/etc/letsencrypt` e correspondencia da chave. Nginx usa TLS 1.2/1.3, HSTS, CSP, headers, limites, timeouts, gzip e rate limiting. Renovacao e reload atingem somente `devflow-nginx`.

## Supply chain e runtime

- checkout canonico HTTPS, commit remoto e fast-forward validados;
- hooks Git desabilitados no checkout operacional;
- labels OCI de versao e revisao;
- backend e migrations executam como usuario nao root;
- migrations sao `root:root 0755/0644`, sem escrita ou execucao pelo runtime;
- Compose recebe ambiente por `--env-file` validado e nunca por `source`;
- instalacao, update, backup e restore usam locks e estado atomico.

## Atualizacao via frontend

Somente o Super Admin pode consultar capacidades e criar um pedido de atualizacao. O backend grava JSON de schema estrito, nonce aleatorio e assinatura HMAC em volume privado. O `devflow-updater` valida tamanho, tipo, idade, ID, allowlist e assinatura em tempo constante e delega exclusivamente ao `update.sh`. Nenhum campo vira comando ou argumento de shell. O socket Docker permanece um privilegio de alto impacto, isolado no updater, e exige homologacao de seguranca antes de producao.
