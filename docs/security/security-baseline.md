# Baseline de seguranca

## Limite isolado

O DevFlow controla somente recursos prefixados ou armazenados em seu namespace: containers `devflow-*`, redes `devflow_edge`/`devflow_internal`, `/opt/devflow`, quatro unidades systemd e locks `devflow-*` em `/run/lock`. Nao executa prune global, nao modifica virtual hosts do host e nao adapta proxies existentes.

## Rede

- somente `devflow-nginx` publica 80/443;
- PostgreSQL nao publica porta e conecta apenas a rede interna;
- frontend conecta apenas a borda;
- backend intermedia borda e rede interna;
- Certbot acessa somente ACME/certificados e a borda.

## Segredos

O ambiente privado, passphrase e token de bootstrap usam modo `0600`. Logs passam por sanitizacao. Segredos sao gerados com OpenSSL, nunca exibidos nem versionados.

## TLS e proxy

O challenge ACME e comprovado por HTTP antes da emissao. A configuracao HTTPS somente e promovida depois de validar dominio/SAN. Nginx usa TLS 1.2/1.3, HSTS, CSP, headers de seguranca, limites, timeouts, gzip e rate limiting. Renovacao e reload atingem somente `devflow-nginx`.

## Supply chain e runtime

- checkout canonico HTTPS, commit remoto e fast-forward validados;
- hooks Git desabilitados no checkout operacional;
- labels OCI de versao e revisao;
- backend e migrations executam como usuario nao root;
- migrations sao `root:root 0755/0644`, sem escrita ou execucao pelo runtime;
- Compose recebe ambiente por `--env-file` validado e nunca por `source`;
- instalacao, update, backup e restore usam locks e estado atomico.

## Atualizacao via frontend

O endpoint administrativo `GET /api/operations/update/capabilities` publica somente metadados imutaveis do contrato allowlisted e informa `executionAvailable=false`. Uma futura API de execucao devera chamar apenas `update-operation.sh`, sob MFA, auditoria e um servico operacional restrito. Nao existe endpoint para shell arbitrario e nenhuma tela foi implementada nesta fase.
