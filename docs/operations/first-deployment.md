# Primeiro deployment de homologacao

O DevFlow `0.6.33-alpha` exige controle exclusivo de 80/443.

1. Inspecione transacao, containers e volumes existentes.
2. Configure todos os registros A para o IPv4 publico da VPS.
3. Libere 80/TCP e 443/TCP no firewall externo.
4. Em host limpo, execute `sudo ./install.sh` e confirme os dois menus numericos.
5. Use `--resume --firewall-confirmed` para a tentativa parcial do estagio 14; a retomada deve preservar banco, backend e frontend saudaveis.
6. Valide `health.sh`, `version.sh`, `installation.json` e o timer de renovacao.
7. Leia a senha temporaria com root, troque-a imediatamente e conclua MFA.
8. Execute manualmente `renew-certificate.sh --dry-run` somente depois da instalacao saudavel.

Nao use `curl | bash`, nao use `-k`, nao remova volumes e nao rode `docker system prune`.
