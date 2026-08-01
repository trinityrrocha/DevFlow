# Primeiro deployment de homologação

## Gate antes da VPS

- repositório público `trinityrrocha/DevFlow` e bootstrap baixado por HTTPS;
- branch `main` e checkout limpo;
- commit e autoria conferidos;
- DNS exclusivo já propagado;
- snapshot da VPS;
- janela de homologação e responsável definidos;
- decisão explícita entre proxy `isolated` e `shared`;
- backup e probes das aplicações vizinhas, quando existirem.

## Execução

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
./install.sh --check
./install.sh --dry-run \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
sudo ./install.sh --install \
  --proxy-mode isolated \
  --domain devflow.exemplo.com \
  --letsencrypt-email tls@exemplo.com \
  --super-admin-email admin@exemplo.com
```

Alternativamente, `sudo ./install.sh` coleta os dados interativamente. Antes de executar, revise o arquivo baixado. O bootstrap valida que a cópia clonada pertence a `trinityrrocha/DevFlow`, que `main` corresponde ao commit remoto e que `VERSION` contém `0.3.0-alpha`.

Para Nginx do host, substitua por `--proxy-mode shared` e confirme as portas loopback planejadas. O instalador pedirá autorização separada para o diagnóstico read-only. Só prossiga se o resultado for `Integração automática compatível.`

Se identificar `fullpassword_nginx`, só prossiga quando todos os fatos do contrato aprovado resultarem em `compatible-with-compose-override`; leia o [runbook do adaptador](../infrastructure/fullpassword-nginx-adapter.md). Para outro Nginx containerizado ou Caddy, preserve o relatório e encerre o ensaio. Não conecte redes, copie arquivos ou recarregue o proxy manualmente.

O ensaio do commit `4d350685cbc9d21b49fb4c01176b846ca66d6584` terminou nesse gate após detectar `fullpassword_nginx`. Ele é evidência histórica do fail-closed e do inventário, não homologação do adaptador `0.3.0-alpha`.

## Aceite mínimo

O aceite só se aplica quando a instalação chega aos health checks. Uma interrupção fail-closed é evidência de proteção, não instalação aprovada.

```bash
curl --fail --silent https://devflow.exemplo.com/
curl --fail --silent https://devflow.exemplo.com/api/health
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
sudo /opt/devflow/app/scripts/backup.sh
```

Verifique:

- todos os serviços necessários estão `healthy`;
- `/api/health` informa `0.3.0-alpha` e migration `001_initial_schema.sql`;
- em coexistência, `health.sh` confirma `nginx -t`, `dev.sti1.com.br`, `pw.sti1.com.br` e ausência do PostgreSQL na rede de borda;
- o certificado corresponde ao domínio;
- o Super Admin troca a senha e configura MFA;
- o backup existe, tem tamanho maior que zero e está fora do repositório;
- aplicações vizinhas mantêm status, certificado e resposta anteriores;
- nenhum segredo aparece nos logs ou no diagnóstico.

## Registro

Guarde fora do Git:

- hash do commit instalado;
- relatório `/opt/devflow/data/install-report.txt`;
- versão, branch, URL pública e canal registrados nesse relatório;
- horário, operador e resultado dos probes;
- caminho e checksum do primeiro backup;
- riscos aceitos e falhas observadas.

Uma instalação aprovada para homologação não equivale a aprovação para produção.
