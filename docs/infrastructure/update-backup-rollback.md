# Atualização, backup, restauração e rollback

> O mecanismo abaixo é destinado exclusivamente à VPS de homologação. Ele ainda precisa de ensaios de falha em Linux antes de qualquer avaliação para produção.

## Separção de responsabilidades

`install.sh` executa somente a primeira instalação. Ele não aceita modo de atualização nem modifica uma instalação existente. Toda consulta e aplicação de novas versões pertence a `scripts/update.sh`.

O desenvolvimento, os commits e o push da `main` acontecem apenas no Windows. A VPS mantém um checkout operacional protegido em `/opt/devflow/source`, usado exclusivamente para leitura de `origin/main` e materialização de releases. Não edite, desenvolva ou crie commits nesse checkout.

## Identidade de versão

`VERSION` é a fonte canônica. Backend, frontend, Compose e documentação devem usar o mesmo SemVer. Consulte o ambiente sem alterções:

```bash
sudo /opt/devflow/app/scripts/version.sh --installed
sudo /opt/devflow/app/scripts/version.sh --all --refresh
```

O segundo comando consulta anonimamente o repositório público por HTTPS. O updater aceita apenas a URL canônica de `trinityrrocha/DevFlow`, branch `main`, checkout limpo, fast-forward e uma versão SemVer estritamente superior.

## Atualização transacional

Primeiro consulte a versão e o changelog sem alterar o host:

```bash
sudo /opt/devflow/app/scripts/update.sh --check
```

Esse modo busca `main` em um repositório temporário sob `/tmp`, removido ao sair. Ele não altera refs do checkout operacional, não cria backup, release ou log persistente e não toca containers.

Depois, execute a atualização interativa:

```bash
sudo /opt/devflow/app/scripts/update.sh
```

O operador precisa digitar `ATUALIZAR DEVFLOW`. O fluxo mantém um lock exclusivo e:

1. valida SO, recursos, Docker, Compose, configuração, proxy e propriedade do checkout;
2. consulta `origin/main`, mostra versões, commits e a seção correspondente do `CHANGELOG.md`;
3. cria um backup criptografado e valida envelope, estrutura, tamanho e checksums;
4. materializa o commit remoto em `/opt/devflow/releases/<sha>` e valida os componentes transacionais;
5. avança o checkout operacional somente por fast-forward;
6. constrói as imagens candidatas;
7. ativa uma resposta HTTPS de manutenção `503` com `Retry-After`;
8. para backend e frontend antes de alterar o schema;
9. inicia e valida PostgreSQL, executa migrations sob advisory lock e confirma a versão no banco;
10. recria somente backend e frontend DevFlow e executa health checks internos;
11. promove o link `/opt/devflow/app`, restaura o proxy e executa health checks públicos;
12. atualiza o timer de backup e grava o relatório final.

Nenhuma etapa executa force pull, prune global, remoção de volumes ou restart de aplicação vizinha.

## Modo de manutenção

No modo `isolated`, o edge DevFlow é parado e um Compose independente, `docker-compose.maintenance.yml`, assume temporariamente 80/443. No `shared` com Nginx do host, somente o virtual host DevFlow é trocado após `nginx -t`. Com `fullpassword_nginx`, override e virtual host recebem snapshot, o merge e a candidata Nginx são validados, somente o serviço `nginx` é recriado com os dois Compose e os dois domínios participam do gate.

O updater confirma HTTP `503` antes de migrations. A remoção da manutenção ocorre somente depois dos checks internos, e os checks públicos ainda fazem parte do gate transacional.

## Rollback automático

Antes da primeira mutação, uma falha apenas remove os temporários gerados e deixa a instalação intacta. Depois que o backup e a release candidata foram validados e a transação foi armada, qualquer saída diferente de zero aciona automaticamente:

1. retorno ou permanência no modo de manutenção;
2. restauração do PostgreSQL e dos uploads a partir do backup pré-update autenticado;
3. revogação das sessões existentes;
4. retorno do ambiente, symlink e checkout ao commit anterior;
5. rebuild e inicialização dos containers anteriores;
6. health checks internos da versão anterior;
7. restauração do proxy e retirada da manutenção;
8. health checks públicos e restauração do timer de backup.

Se a atualização precisou criar a rede externa `devflow_edge`, um rollback a remove somente depois que os containers anteriores e o proxy deixarem de usá-la. Uma rede preexistente nunca é assumida como DevFlow sem a label de propriedade.

O resultado fica em `/opt/devflow/data/update-report.txt`; o log sanitizado fica em `/opt/devflow/logs/update-<timestamp>.log`. Se o rollback também falhar, o script registra cada falha, tenta retirar a manutenção e encerra com erro. Nesse caso, preserve o ambiente e siga o runbook de troubleshooting; nunca marque migration ou versão manualmente.

## Backup manual

```bash
sudo /opt/devflow/app/scripts/backup.sh
sudo /opt/devflow/app/scripts/verify-backup.sh \
  /opt/devflow/backups/devflow-AAAAMMDDTHHMMSSZ-ID.dfbackup
```

O backup usa `pg_dump -Fc`, compacta uploads, registra manifesto e checksums e aplica envelope autenticado AES-256-GCM. A chave deriva por scrypt da passphrase protegida em `/opt/devflow/config/backup.passphrase`. Arquivos recebem modo `0600`; a retenção padrão é 30 dias.

O pacote contém `manifest.json`, `checksums.sha256`, `database.dump` e `uploads.tar.gz`. A existência do arquivo não substitui verificação nem restore drill. Cópia remota e política 3-2-1 continuam sob responsabilidade operacional.

## Restauração manual

```bash
sudo CONFIRM_RESTORE='RESTAURAR BACKUP' \
  /opt/devflow/app/scripts/restore.sh \
  /opt/devflow/backups/devflow-AAAAMMDDTHHMMSSZ-ID.dfbackup
```

O restore manual cria outro backup antes de agir, autentica o envelope, rejeita travessia e tipos especiais, limita o tamanho expandido, restaura banco e uploads, revoga sessões e espera health checks. A restauração substitui toda a instância; não existe restore seletivo por empresa.

As variáveis internas que evitam o backup adicional e mantêm o backend parado são reservadas à coordenação do updater. Não as use em operações manuais.

## Gates pendentes para produção

- matriz automatizada de falhas injetadas em todas as fases;
- restore drill periódico e backup remoto 3-2-1;
- migrations aprovadas pelo padrão expand/contract;
- assinatura ou atestação de releases e imagens fixadas por digest;
- renovação TLS, reboot e concorrência testados;
- observabilidade, retenção e alertas aprovados;
- ensaio real do adaptador com falhas de Compose, ACME, `nginx -t`, recriação e health, sem regressão do Full Password.
