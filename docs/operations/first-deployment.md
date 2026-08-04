# Primeiro deployment de homologação

> Em `0.4.9-alpha`, reconcilie primeiro o estado instalado com `/opt/devflow/source`. A detecção de `fullpassword_nginx` não autoriza integração nem impede o estágio interno.

## Gate antes da VPS

- repositório público `trinityrrocha/DevFlow` e bootstrap baixado por HTTPS;
- branch `main` e checkout limpo;
- commit e autoria conferidos;
- DNS exclusivo propagado somente antes da publicação externa;
- snapshot da VPS;
- janela de homologação e responsável definidos;
- provider externo planejado, sem ativação durante a instalação interna;
- backup e probes das aplicações vizinhas, quando existirem.

## Execução

```bash
wget -O install.sh https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/scripts/bootstrap.sh
chmod +x install.sh
./install.sh --check
sudo ./install.sh --dry-run \
  --install-scope internal \
  --super-admin-email admin@exemplo.com
sudo ./install.sh --install-internal \
  --super-admin-email admin@exemplo.com
```

Alternativamente, `sudo ./install.sh` coleta os dados interativamente. Antes de executar, revise o arquivo baixado. O bootstrap valida que a cópia clonada pertence a `trinityrrocha/DevFlow`, que a referência corresponde ao commit remoto e que `VERSION` é SemVer consistente com todos os componentes. Em `main`, a versão é detectada dinamicamente; um pin só existe com `--expected-version`.

Com 80/443 ocupadas, homologue por túnel SSH em `http://127.0.0.1:18080`. A publicação por `scripts/publish.sh` é posterior e permanecerá bloqueada até as portas estarem livres ou a migração separada ser concluída.

Se identificar `fullpassword_nginx`, confirme `owner_proven=true` para 80 e 443. Isso autoriza apenas a instalação interna; não conecte redes, copie arquivos, crie overrides ou recarregue o proxy manualmente.

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
- `/api/health` informa `0.4.9-alpha`, commit instalado e migration `001_initial_schema.sql`;
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
