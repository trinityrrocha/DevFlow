# Atualização, backup, restauração e rollback

> Esta operação é preliminar e exclusiva para homologação. O WebUpdater transacional definitivo ainda não foi implementado.

## Backup

```bash
sudo /opt/devflow/app/scripts/backup.sh
```

O script executa `pg_dump -Fc`, compacta uploads, cria manifesto e checksums, empacota o conteúdo e aplica um envelope autenticado AES-256-GCM. A chave é derivada por scrypt da passphrase protegida em `/opt/devflow/config/backup.passphrase`.

```text
devflow-AAAAMMDDTHHMMSSZ.dfbackup
└── envelope AES-256-GCM
    └── payload.tar.gz
        ├── manifest.json
        ├── checksums.sha256
        ├── database.dump
        └── uploads.tar.gz
```

Arquivos recebem modo `0600` em `/opt/devflow/backups`. A retenção padrão é 30 dias. O timer systemd executa diariamente às 02:30 com atraso aleatório de até 15 minutos.

Verifique autenticação, estrutura e checksums sem restaurar:

```bash
sudo /opt/devflow/app/scripts/verify-backup.sh \
  /opt/devflow/backups/devflow-AAAAMMDDTHHMMSSZ.dfbackup
```

Limitações: a cópia remota e a política 3-2-1 não são automatizadas; o operador deve copiar e verificar backups fora da VPS. A existência de um arquivo não substitui um restore drill.

## Restauração

Antes de restaurar, copie o pacote para o host, confirme origem e checksum e mantenha snapshot da VPS.

```bash
sudo CONFIRM_RESTORE='RESTAURAR BACKUP' \
  /opt/devflow/app/scripts/restore.sh \
  /opt/devflow/backups/devflow-AAAAMMDDTHHMMSSZ.dfbackup
```

O restore:

1. exige confirmação literal e limita tamanho;
2. cria backup pré-restore;
3. autentica e descriptografa o envelope;
4. rejeita caminhos absolutos, travessia, links e tipos especiais;
5. verifica checksums e tamanho expandido;
6. para somente o backend DevFlow;
7. restaura PostgreSQL e uploads;
8. revoga todas as sessões anteriores;
9. reinicia e espera os healthchecks.

O processo substitui banco e storage da instância inteira. Não existe restore seletivo por empresa nesta baseline.

## Atualização preliminar

No checkout privado usado para operação:

```bash
cd /caminho/do/checkout/DevFlow
git status --short
git remote -v
git branch --show-current
sudo ./scripts/update.sh
```

O wrapper encaminha para `scripts/install.sh --update`. O fluxo:

1. exige instalação existente e configuração modo `0600`;
2. valida Docker/Compose, capacidade, proxy, domínio e recursos;
3. aceita apenas remote `trinityrrocha/DevFlow`, branch `main` e checkout limpo;
4. gera e confirma backup não vazio;
5. faz `fetch` e aceita somente fast-forward;
6. arquiva o novo SHA em uma release imutável;
7. valida Compose e constrói frontend/backend;
8. espera PostgreSQL saudável e aplica migrations sob advisory lock;
9. confirma a migration consultando o banco;
10. recria somente serviços DevFlow;
11. espera healthchecks e probes HTTPS;
12. promove o link `/opt/devflow/app`.

Não há force pull, reset, prune, remoção de volumes ou restart de aplicação vizinha.

## Falha e recuperação

Uma falha remove o link candidato, grava `result=failure` e preserva configuração, dados, backup e release anterior. Isso não é rollback automático completo: se uma migration já tiver alterado o schema, apontar o código anterior pode ser incompatível.

Recuperação controlada:

1. não repita migrations nem marque versões manualmente;
2. colete diagnóstico sanitizado;
3. confirme o último backup fora do host quando possível;
4. avalie compatibilidade da release anterior com o schema;
5. restaure o backup pré-update quando necessário;
6. valide banco, backend, frontend, proxy e aplicações vizinhas;
7. registre o incidente e preserve os logs sanitizados.

O rollback automático, canário, assinatura de release e coordenação transacional entre schema e código permanecem gates do Documento 004 ou fase posterior.

## Critérios pendentes para produção

- restore drill automatizado e periódico;
- armazenamento remoto e alerta de backup;
- atualização interrompida em cada etapa;
- migrations compatíveis por expand/contract;
- rollback automático testado;
- renovação TLS testada;
- observabilidade e retenção aprovadas;
- ensaio de coexistência sem regressão do Full Password.
