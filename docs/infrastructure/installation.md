# Instalacao isolada

O DevFlow `0.6.14-alpha` possui um unico modo de instalacao. O host deve usar Ubuntu 22.04/24.04, AMD64/ARM64, ter DNS A valido e reservar as portas 80/443 exclusivamente ao DevFlow.

O fluxo publico comum e `sudo ./install.sh`. Quando nenhuma opcao de modo e fornecida, o bootstrap repassa `--install` explicitamente ao instalador interno. `--check`, `--dry-run` e `--resume` nunca sao convertidos em instalacao.

O preflight compara IPv4 publico obtido por fontes independentes com todos os registros A do dominio, identifica proprietarios das portas, valida recursos e solicita confirmacao numerica do firewall externo. Divergencia de IP, porta com dono desconhecido ou dependencia insegura bloqueia qualquer mutacao.

Fluxo material:

1. preparar diretorios, fonte canonica e ambiente privado `0600`;
2. construir backend, frontend e updater e baixar PostgreSQL/Nginx;
3. parar somente `devflow-nginx` se uma tentativa parcial ocupar 80/443;
4. reutilizar certificado valido ou executar Certbot standalone no host;
5. validar validade, dominio/SAN, links sob `/etc/letsencrypt` e par chave/certificado;
6. gerar `config/nginx/nginx.runtime.conf`;
7. ativar atomicamente `/opt/devflow/app` para a release candidata e criar `state/installation-in-progress` como `root:root 0600`;
8. iniciar banco, migrations, backend, worker de e-mail, frontend, Nginx e updater nessa ordem;
9. manter o updater healthy, mas sem consumir a fila enquanto o marcador existir;
10. criar o Super Admin e validar HTTPS local com `curl --resolve`, sem `-k`;
11. gravar e promover atomicamente o estado schema v3, valida-lo e recarrega-lo com o codigo instalado;
12. executar `/opt/devflow/app/scripts/health.sh --quiet` em novo processo e impedir a mensagem de sucesso em qualquer falha;
13. confirmar o symlink, remover o marcador, habilitar timers e, somente em TTY, exibir a credencial inicial fora do log.

Persistencia:

```text
/opt/devflow/{source,releases,config,state,logs,backups,storage,updater}
/etc/letsencrypt/live/<dominio>
```

Em falha, containers, volumes, imagens, fonte, configuracao e logs sao preservados. Se havia um `/opt/devflow/app` valido, o destino anterior e restaurado atomicamente; em instalacao inicial, somente o symlink candidato e removido. O marcador permanece para bloquear updates ate uma retomada concluida. Use `sudo ./install.sh --resume --firewall-confirmed`; segredos existentes nao sao regenerados.

O instalador e exclusivo para instalacao inicial/retomada. Atualizacoes manuais usam `scripts/update-cli.sh`, que delega ao motor nao interativo `scripts/update.sh`. O modo MFA inicial e persistido como `optional`; isso nao interfere na troca obrigatoria da senha temporaria.
