# Primeiro deployment de homologacao

O DevFlow 0.5.0-alpha requer VPS exclusiva para suas portas publicas.

1. Configure DNS.
2. Execute `./install.sh --check`.
3. Execute o dry-run com dominio e e-mail.
4. Execute `sudo ./install.sh`.
5. Valide `health.sh`, estado schema v3, certificado e timer de renovacao.
6. Consulte com `sudo` a senha temporaria em `/opt/devflow/config/super-admin-temporary-password`, entre com o e-mail administrativo e conclua a troca obrigatoria de senha e MFA.

Nao instale se 80/443 estiverem ocupadas. Nao mova ou adapte proxies de outras aplicacoes.
