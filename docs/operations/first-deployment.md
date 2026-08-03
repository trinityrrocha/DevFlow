# Primeiro deployment de homologação

> Em `0.4.1-alpha`, selecione `host-nginx` (padrão). O bootstrap apresenta primeiro o Nginx central no host; `isolated-nginx` é apenas para VPS exclusiva. A detecção de `fullpassword_nginx` não autoriza integração: o instalador interrompe e exige a [migração separada](../infrastructure/proxy-migration.md).

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

Alternativamente, `sudo ./install.sh` coleta os dados interativamente. Antes de executar, revise o arquivo baixado. O bootstrap valida que a cópia clonada pertence a `trinityrrocha/DevFlow`, que `main` corresponde ao commit remoto e que `VERSION` contém `0.4.1-alpha`.

Para Nginx do host, substitua por `--proxy-mode shared` e confirme as portas loopback planejadas. O instalador pedirá autorização separada para o diagnóstico read-only. Só prossiga se o resultado for `Integração automática compatível.`

Se identificar `fullpassword_nginx`, só prossiga quando todos os fatos do contrato aprovado resultarem em `compatible-with-compose-override`; leia o [runbook do adaptador](../infrastructure/fullpassword-nginx-adapter.md). Para outro Nginx containerizado ou Caddy, preserve o relatório e encerre o ensaio. Não conecte redes, copie arquivos ou recarregue o proxy manualmente.

O check da versão `0.3.2-alpha`, commit `be1636861505d4f8bedbd42e84d3d66eb70f6fad`, detectou o `.env`; o dry-run parou por variável interna não inicializada. Em `0.3.3-alpha`, execute primeiro `--check`, depois o dry-run comum e, quando orientado, repita o mesmo dry-run com `sudo`. O ensaio privilegiado permanece pendente e não autoriza declarar o adaptador homologado.

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
- `/api/health` informa `0.4.1-alpha` e migration `001_initial_schema.sql`;
- em coexistência, `health.sh` confirma `nginx -t`, `dev.sti1.com.br`, `pw.sti1.com.br` e ausência do PostgreSQL na rede de borda;
- o certificado corresponde ao domínio;
- o Super Admin troca a senha e configura MFA;
- o backup existe, tem tamanho maior que zero e está fora do repositório;
- aplicações vizinhas mantêm status, certificado e resposta anteriores;
- nenhum segredo aparece nos logs ou no diagnóstico.

## Registro

Guarde fora do Git:

- hash do commit instalado;
- relatório `/opt/devflow/state/installation.json` e versão em `/opt/devflow/state/version.json`;
- versão, branch, URL pública e canal registrados nesse relatório;
- horário, operador e resultado dos probes;
- caminho e checksum do primeiro backup;
- riscos aceitos e falhas observadas.

Uma instalação aprovada para homologação não equivale a aprovação para produção.
