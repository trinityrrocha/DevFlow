# Providers de infraestrutura

Desde `0.4.0-alpha`, o instalador é um orquestrador e toda responsabilidade de proxy é delegada a um provider. A fonte de verdade instalada é `/opt/devflow/state/infrastructure-provider.json`; os campos antigos `DEVFLOW_PROXY_MODE` e `DEVFLOW_SHARED_PROXY_ADAPTER` existem somente para compatibilidade.

## Contrato

Todo provider implementa `provider_detect`, `provider_check`, `provider_dry_run`, `provider_prepare`, `provider_install`, `provider_validate`, `provider_health`, `provider_update`, `provider_rollback` e `provider_uninstall`. Os códigos comuns são: `0` aprovado, `1` falha de segurança/saúde, `2` uso inválido, `3` validação privilegiada necessária e `4` migração controlada obrigatória.

`check` e `dry_run` não podem escrever, instalar, recarregar serviços ou recriar containers. Cada implementação declara os recursos que pode alterar e falha quando a propriedade não é comprovada.

## Providers disponíveis

| Provider | Uso | Exposição |
|---|---|---|
| `host-nginx` | Padrão recomendado para novas instalações | Nginx do host em 80/443; frontend `127.0.0.1:18080`; API `127.0.0.1:13000` |
| `isolated-nginx` | VPS exclusiva do DevFlow | container `edge` exclusivo em 80/443 |
| `legacy-docker-nginx` | Transição, diagnóstico e rollback | adaptador descontinuado do `fullpassword_nginx`; somente seleção explícita |

O PostgreSQL nunca publica uma porta no host. Portainer, Dockge e ferramentas semelhantes são opcionais e não fazem parte do contrato.

## Estado persistente

```json
{
  "provider": "host-nginx",
  "version": 1,
  "domain": "devflow.example.com",
  "frontendPort": 18080,
  "backendPort": 13000
}
```

O arquivo é gravado atomicamente em modo `0640`. Update, health e uninstall recusam estado inválido ou divergente da configuração protegida.
