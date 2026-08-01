# Segurança do DevFlow

O DevFlow possui uma baseline funcional; ela ainda não foi homologada para produção.
A política obrigatória está em
[docs/security/security-baseline.md](docs/security/security-baseline.md).

Não publique vulnerabilidades, segredos, tokens, dados pessoais ou arquivos de backup em issues públicas.

Para qualquer incidente futuro:

1. preserve evidências sem copiar segredos para logs;
2. revogue as credenciais afetadas;
3. isole a versão e o ambiente;
4. registre horário, usuário, origem e impacto;
5. execute restauração apenas pelo runbook aprovado.

## Controles presentes

- Argon2id, sessão server-side, cookies `HttpOnly`, CSRF e MFA TOTP;
- autorização backend-first e troca obrigatória de senha temporária;
- Super Admin e último administrador protegidos;
- histórico e auditoria imutáveis no PostgreSQL;
- anexos com allowlist, limite, nome aleatório e checksum;
- segredos validados no startup e sanitizados em auditoria/log;
- backup autenticado com scrypt e AES-256-GCM.

## Limites atuais

Antes de produção ainda são obrigatórios testes de integração em Docker/PostgreSQL,
laboratório de coexistência, restore drill, análise de dependências/imagens, pentest e
testes E2E. Consulte [Estado de implementação](docs/implementation-status.md).
