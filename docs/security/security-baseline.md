# Baseline de segurança

## 1. Autenticação

- Argon2id com parâmetros versionados e benchmarkados no hardware alvo.
- Sessão em cookie `HttpOnly`, `Secure`, `SameSite=Strict`, escopo mínimo.
- Token assinado com segredo de pelo menos 64 caracteres aleatórios.
- Registro de sessão no banco contendo apenas hash do token.
- Expiração absoluta e por inatividade.
- Revogação por sessão, por usuário e global via `token_version`.
- Troca obrigatória da credencial temporária.
- Resposta genérica para login e recuperação, evitando enumeração.

## 2. MFA e recuperação

- TOTP com desafio de curta duração e audience específica.
- Códigos de recuperação aleatórios, uso único e hash Argon2id.
- Reset de MFA restrito ao Super Admin, com revogação de sessões.
- Token de recuperação aleatório, validade de 30 minutos, uso único e hash SHA-256 no banco.
- Recuperação nunca deve prometer recuperar material criptográfico que não possa ser reconstruído.
- A primeira identidade administrativa permanece restrita até trocar a senha e confirmar MFA.
- O bootstrap não usa senha fixa: e-mail e token inicial ficam em arquivos protegidos e o token deve ser removido após uso.

## 3. Autorização

- Toda rota protegida autentica e autoriza no backend.
- O frontend apenas oculta ou desabilita controles.
- Ações administrativas críticas exigem `is_super_admin`.
- Permissões devem ser verificadas no recurso, não só na rota.
- Testes cobrem acesso permitido, negado, inativo, revogado e concorrente.

## 4. CSRF, CORS e headers

- CSRF assinado para métodos mutáveis com sessão em cookie.
- CORS com uma lista explícita de origens.
- CSP sem `unsafe-inline` e sem origem coringa.
- HSTS, `frame-ancestors 'none'`, nosniff, referrer policy e permissions policy.
- Limites distintos para JSON comum, upload e streaming.

## 5. Rate limiting

Limitadores independentes para:

- login e bootstrap;
- MFA;
- recuperação de acesso;
- escrita geral;
- operações sensíveis;
- update;
- backup;
- integração externa.

O limite de emergência em memória não substitui o bloqueio persistido por política.

## 6. Segredos

- `.env` com permissão `0600`.
- Geração criptográfica, sem exibir valores no terminal ou log.
- Chave de configuração base64 canônica de 32 bytes.
- Envelopes AES-256-GCM com IV de 12 bytes e versão.
- Segredos nunca retornam à UI após salvos; apenas estado mascarado.
- Rotação inclui inventário, recriptografia e rollback.
- Perda da chave deve estar documentada como cenário de desastre.
- Na VPS, `devflow.env`, `backup.passphrase` e `bootstrap-token` ficam fora da release com modo `0600`.
- Diagnóstico não coleta conteúdo do ambiente, anexos ou dados pessoais e aplica redação adicional aos logs.

## 7. Auditoria

Cada evento sensível registra:

- ator e alvo;
- ação e resultado;
- request ID;
- IP e user-agent normalizados;
- horário UTC;
- metadados allowlisted;
- nunca senha, token, segredo, passphrase ou payload confidencial.

Auditoria é append-only para a aplicação. Alteração ou purga exige job administrativo separado e retenção aprovada.

## 8. Exclusões

- confirmação textual `EXCLUIR` para ação irreversível;
- confirmação contextual exibindo o recurso alvo;
- bloqueio de autoexclusão e do último administrador;
- trigger ou constraint para identidades invariantes;
- soft delete e período de recuperação por padrão;
- hard delete somente por job de purga, com auditoria;
- transação e lock de linha para invariantes concorrentes.

## 9. Infraestrutura

- imagens fixadas por versão e, em produção, digest.
- containers non-root quando possível.
- filesystem read-only e capabilities removidas.
- nenhum banco publicado em interface externa.
- bind de aplicação em `127.0.0.1` quando passar por Nginx do host.
- socket Docker não é montado no backend web.
- operador recebe proxy restrito ou operações allowlisted.
- certificados montados somente leitura.
- instalador falha diante de recursos sem propriedade comprovada e nunca executa prune global.
- a detecção de `fullpassword_nginx`, Nginx containerizado ou Caddy bloqueia integração automática; somente relatório sanitizado e confirmado pode ser criado, sem alterar arquivo, rede, volume, certificado ou serviço vizinho;
- o PostgreSQL permanece exclusivamente em `devflow_internal`; proxy, frontend e edge não recebem acesso à rede do banco;
- a rota exclusiva do Nginx do host é promovida atomicamente e restaurada em falha de sintaxe ou reload;
- bootstrap público valida HTTPS canônico, `main`, commit remoto, `VERSION`, integridade Git e equivalência do próprio bootstrap antes de chamar o instalador;
- updater aceita somente o HTTPS público de `trinityrrocha/DevFlow`, `main`, fast-forward, checkout root limpo e hooks desabilitados;
- instalação e atualização na VPS não dependem de token, deploy key, chave SSH ou autenticação GitHub;
- backup autenticado e release candidata íntegra são gates anteriores à mutação do código instalado;
- migrations ocorrem com tráfego em manutenção e serviços de aplicação parados;
- falhas acionam restauração coordenada de dados, release, containers e proxy, com log sanitizado.

## 10. Publicação segura

- `.env` real, backups, dumps, logs, chaves e dados runtime são ignorados e auditados antes do commit;
- a auditoria local busca tokens conhecidos, chaves privadas, caminhos de estação Windows e links internos inválidos;
- a conta GitHub autorizada é exclusivamente `trinityrrocha`;
- autoria Git deve vir da identidade já configurada pelo proprietário, sem e-mail inventado ou coautoria;
- a abertura pública exige auditoria do checkout e de todos os blobs alcançáveis do histórico;
- a publicação permanece somente na `main`, sem tag, release, PR ou force push;
- enquanto não existir `LICENSE`, a visibilidade pública não concede automaticamente direito de uso, modificação ou redistribuição.

## 11. Definition of Done de segurança

Uma funcionalidade não está pronta sem:

- threat model proporcional;
- validação de entrada e saída;
- autorização no backend;
- teste negativo;
- evento de auditoria quando sensível;
- mensagem segura para o usuário;
- ausência de segredos em logs e fixtures;
- análise do impacto em backup, restore e exclusão.
