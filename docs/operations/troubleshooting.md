# Troubleshooting

## Portas 80/443 ocupadas

O instalador imprime `port=` e `owner=` e encerra sem alteracoes. Libere as portas manualmente ou use outra VPS. Nao altere containers de terceiros pelo instalador.

## DNS nao resolve

Confirme todos os registros A e aguarde propagacao. O certificado nao e solicitado se as duas fontes de IPv4 publico divergirem ou se qualquer conjunto DNS nao contiver o IP da VPS.

## ACME falha

Confirme que DNS A aponta para a VPS, 80/443 chegam pelo firewall externo e nenhum processo ocupa as portas. O instalador usa Certbot standalone; nao existe Nginx temporario nem webroot ACME. Em uma tentativa parcial, somente `devflow-nginx` e parado, os demais containers permanecem, e a transacao registra `07-certificate` para `--resume`.

## Migration sem permissao

Nao execute como root nem edite a imagem. O backend exige `/database` e `/database/migrations` em `0755 root:root` e SQLs em `0644 root:root`.

## Diagnostico

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/diagnostic.txt
```

O relatorio e sanitizado e nao inclui ambiente privado, tokens, chaves, dados pessoais ou anexos.

## Update falhou

Consulte o ultimo `update-report.txt` e log sanitizado. O motor tenta restaurar backup, release, containers e Nginx isolado. Nao remova a release ou backup anterior antes da analise.
