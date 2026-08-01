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

Alternativamente, `sudo ./install.sh` coleta os dados interativamente. Antes de executar, revise o arquivo baixado. O bootstrap valida que a cópia clonada pertence a `trinityrrocha/DevFlow`, que `main` corresponde ao commit remoto e que `VERSION` contém `0.2.0-alpha`.

Para Nginx do host, substitua por `--proxy-mode shared` e confirme as portas loopback planejadas.

## Aceite mínimo

```bash
curl --fail --silent https://devflow.exemplo.com/
curl --fail --silent https://devflow.exemplo.com/api/health
sudo /opt/devflow/app/scripts/diagnose.sh --output /tmp/devflow-diagnostic.txt
sudo /opt/devflow/app/scripts/backup.sh
```

Verifique:

- todos os serviços necessários estão `healthy`;
- `/api/health` informa `0.2.0-alpha` e migration `001_initial_schema.sql`;
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
