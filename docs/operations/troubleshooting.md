# Troubleshooting

## Portas 80/443 ocupadas

O instalador imprime `port=` e `owner=` e encerra sem alteracoes. Libere as portas manualmente ou use outra VPS. Nao altere containers de terceiros pelo instalador.

## DNS nao resolve

Confirme os registros A/AAAA e aguarde propagacao. O certificado nao e solicitado enquanto `getent ahosts DOMINIO` falhar.

## ACME falha

Confirme acesso externo a `http://DOMINIO/.well-known/acme-challenge/`, firewall e DNS. O Nginx permanece no estagio HTTP/503 e a transacao registra `12-certificate` para retomada.

## Migration sem permissao

Nao execute como root nem edite a imagem. O backend exige `/database` e `/database/migrations` em `0755 root:root` e SQLs em `0644 root:root`.

## Diagnostico

```bash
sudo /opt/devflow/app/scripts/diagnose.sh --output /opt/devflow/logs/diagnostic.txt
```

O relatorio e sanitizado e nao inclui ambiente privado, tokens, chaves, dados pessoais ou anexos.

## Update falhou

Consulte o ultimo `update-report.txt` e log sanitizado. O motor tenta restaurar backup, release, containers e Nginx isolado. Nao remova a release ou backup anterior antes da analise.
