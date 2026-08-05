# Instalacao isolada

O DevFlow `0.5.1-alpha` possui um unico modo de instalacao. O host deve usar Ubuntu 22.04/24.04, AMD64/ARM64, ter DNS A valido e reservar as portas 80/443 exclusivamente ao DevFlow.

O preflight compara IPv4 publico obtido por fontes independentes com todos os registros A do dominio, identifica proprietarios das portas, valida recursos e solicita confirmacao numerica do firewall externo. Divergencia de IP, porta com dono desconhecido ou dependencia insegura bloqueia qualquer mutacao.

Fluxo material:

1. preparar diretorios, fonte canonica e ambiente privado `0600`;
2. construir backend, frontend e updater e baixar PostgreSQL/Nginx;
3. parar somente `devflow-nginx` se uma tentativa parcial ocupar 80/443;
4. reutilizar certificado valido ou executar Certbot standalone no host;
5. validar validade, dominio/SAN, links sob `/etc/letsencrypt` e par chave/certificado;
6. gerar `config/nginx/nginx.runtime.conf`;
7. iniciar banco, migrations, backend, frontend, Nginx e updater nessa ordem;
8. criar o Super Admin e validar HTTPS local com `curl --resolve`, sem `-k`;
9. gravar estado schema v3 e habilitar timers de backup/renovacao.

Persistencia:

```text
/opt/devflow/{source,releases,config,state,logs,backups,storage,updater}
/etc/letsencrypt/live/<dominio>
```

Em falha, containers, volumes, imagens, fonte, configuracao e logs sao preservados. Use `sudo ./install.sh --resume --firewall-confirmed`; segredos existentes nao sao regenerados.
