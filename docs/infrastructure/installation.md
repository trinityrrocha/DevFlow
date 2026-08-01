# Arquitetura de instalação e coexistência

## Contrato do instalador

O entrypoint da raiz encaminha para `scripts/install.sh`. Ambos usam Bash estrito (`set -Eeuo pipefail`) e são somente leitura por padrão.

| Modo | Efeito |
|---|---|
| sem argumento / `--check` | diagnóstico sem mutação |
| `--dry-run` | valida entradas e exibe o plano |
| `--install` | primeira instalação, após confirmação |
| `--update` | atualização preliminar de instalação existente |

O fluxo é `detectar → validar → resumir → confirmar → aplicar → verificar → promover`. Qualquer incompatibilidade antes da confirmação interrompe a execução. Depois que a aplicação começa, falhas removem apenas o link candidato e registram relatório; dados existentes são preservados.

## Plataformas e requisitos

- Ubuntu 22.04/24.04 e Debian 12/13;
- `amd64` e `arm64`;
- Docker Engine 24+ e Compose v2 2.20+;
- 2 GiB de RAM e 5 GiB livres;
- domínio, e-mail TLS, e-mail do Super Admin e modo de proxy explícitos.

Outras plataformas falham de forma segura. A matriz ainda precisa de ensaio automatizado antes de produção.

## Servidor limpo

Docker é instalado somente se ausente e exclusivamente pelo repositório oficial. O instalador cria recursos do projeto `devflow`, configuração privada, banco, migration, aplicação, HTTPS, healthchecks e backup agendado. Não altera firewall nem configurações globais não relacionadas.

## Infraestrutura existente

Docker e Compose compatíveis são reutilizados. O instalador verifica nomes, labels de propriedade, redes, volumes e portas. Recursos com namespace DevFlow mas sem a label esperada causam parada. Nenhum container de terceiros é parado ou reiniciado.

No modo compartilhado, o Nginx do host recebe um único arquivo gerenciado. A candidata é testada no lugar real; em falha, o arquivo anterior é restaurado. No modo isolado, 80/443 precisam estar livres.

## Full Password

O container `fullpassword_nginx` é tratado como limite de segurança: sua detecção bloqueia a instalação automática. A versão alpha não copia arquivos para o container, não conecta rede, não recarrega Nginx, não altera certificados e não instala reconciliador nele.

A coexistência só pode avançar depois que um ponto de extensão persistente, sua rede, certificado, probes e rollback forem comprovados pelo proprietário do ingress. As instruções estão no [guia de VPS](vps-installation.md).

## Recursos próprios

- projeto Compose: `devflow`;
- diretório: `/opt/devflow`;
- banco: `/opt/devflow/data/postgres`;
- uploads: `/opt/devflow/storage/uploads`;
- configuração: `/opt/devflow/config/devflow.env`;
- backups: `/opt/devflow/backups`;
- proxy do host: `/etc/nginx/conf.d/devflow.conf`;
- containers gerados pelo Compose: prefixo previsível `devflow-`.

Não são definidos `container_name` globais: os nomes derivados do projeto Compose evitam colisão e preservam escalabilidade.

## Idempotência e reversibilidade

Uma instalação existente exige `--update`; a primeira instalação não sobrescreve `app`. Arquivos gerenciados carregam marcador de propriedade. Releases são diretórios imutáveis por SHA, e `app.candidate` só é promovido após probes HTTPS.

O rollback transacional de migrations ainda não está implementado. A versão anterior e o backup permanecem disponíveis para recuperação manual. Essa limitação impede classificar a solução como pronta para produção.
