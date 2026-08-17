# WebUpdater 0.6.31-alpha

## Decisao arquitetural

O commit de referencia `804008b5df5d0931ec5d95227fed44086f430d76` do Full Password usa fila em filesystem, daemon persistente, `flock`, Git fast-forward, build Compose, lista fixa de servicos e verificacao final. Nao possui candidate release, promotion state, transaction JSON, tags de rollback ou container de manutencao no update. O DevFlow adota essa sequencia e mantem somente diferencas ligadas a riscos concretos de sua topologia.

| Comportamento | Full Password | DevFlow antigo | DevFlow 0.6.28 |
|---|---|---|---|
| Frontend request | pedido simples | HMAC e muitos estados | HMAC, nonce, CSRF e quatro estados de ciclo |
| Daemon | persistente | persistente, acoplado a transacao | persistente e nao se recria durante o pedido |
| Queue | quatro diretorios | quatro diretorios + status detalhado | quatro diretorios + mensagem sanitizada |
| Lock | `flock` | `flock` | `flock` global compartilhado com backups |
| Git | fetch/checkout/pull | checkout principal avançava antes do build | fetch/checkout/pull em checkout isolado; source avanca somente apos health |
| Build | Compose direto | candidate images | imagens finais `release-<commit>` |
| Migrations | nao possui o mesmo conjunto | estado transacional complexo | sob lock, sem down automatico |
| Compose | lista fixa | promocao candidata | `db/backend/worker/frontend/edge` fixos |
| Updater lifecycle | nao se atualiza no pedido | podia possuir promocao separada | imagem nova e construida, container atual permanece vivo |
| Health | verificacao curta | varios modos candidatos | pre-health e final health contextual |
| Rollback | falha clara, sem orquestrador complexo | tags `rollback-*` e estado schema v3 | restaura release anterior com tag normal; marca recuperacao manual se migrations iniciaram |
| Status | pendente/processando/concluido/falhou | dezenas de fases | pending/processing/completed/failed; rolling-back somente em falha mutavel |
| Changelog | nao governa update | gate obrigatorio | apenas informativo |
| Manutencao | ausente | container HTTP 503 | ausente do WebUpdater; permanece apenas no restore de backup |

## Diferencas justificadas

- O worker entra na allowlist porque processa a outbox e deve usar a mesma imagem do backend.
- HMAC, nonce, replay protection, CSRF e Super Admin permanecem porque o pedido parte de uma API multi-tenant exposta; o Full Password nao elimina esse risco do DevFlow.
- A release imutavel e `installation.json` permanecem porque o instalador ja usa `/opt/devflow/releases/<commit>` e `version.sh` precisa comprovar identidade sem depender do HEAD temporario do checkout.
- O pull isolado evita exatamente o estado observado em 0.6.26: source novo com runtime antigo apos rollback. O source principal recebe somente merge fast-forward para o commit ja aprovado pelo health.
- O rollback operacional existe porque migrations e worker tornam uma falha parcial mais arriscada. Ele nao promete rollback de dados.

## Causa raiz 0.6.26

No `scripts/update.sh` do commit `055e5289d2a817aedda863e4f6faaf93fab480de`, depois de `git pull --ff-only origin main`, a linha 778 chama `render_runtime_nginx_config`. Essa funcao, em `scripts/lib/common.sh`, chama `validate_devflow_certificate ... /etc/letsencrypt`. O serviço updater do Compose monta `/opt/devflow`, Docker socket, lock e fila, mas nao `/etc/letsencrypt`; somente `edge` possui esse volume. O retorno e 1.

O trap `update_failed` chama `rollback_update`. Dentro dele, `write_update_transaction rollback-started` altera `UPDATE_PHASE` para `rollback-started` antes do log. Consequentemente a mensagem esconde a fase capturada e afirma incorretamente que `rollback-started` falhou.

## Bootstrap legado

O daemon 0.6.26 executa `/opt/devflow/app/scripts/update.sh`, ja carregado da release antiga. Nenhum arquivo da release remota e executado antes da chamada defeituosa. Logo nao existe alteracao publicavel capaz de corrigir esse processo em memoria pelo mesmo botao. `scripts/update-bootstrap.sh` e o shim unico, validado e sem pipe; depois dele todos os ciclos usam o motor novo pelo painel.
