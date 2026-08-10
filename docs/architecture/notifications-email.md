# Notificacoes, e-mail e recuperacao

Versao de referencia: `0.6.20-alpha`. Implementacao destinada a homologacao, nao aprovada para producao.

## Fluxo confiavel

Uma mudanca de etapa, atribuicao, atraso ou conclusao abre uma transacao PostgreSQL, atualiza a tarefa e grava notificacao/outbox antes do commit. O `devflow-worker` reivindica lotes com `FOR UPDATE SKIP LOCKED`; somente depois do commit renderiza um template fechado e chama o provedor SMTP. A chave de idempotencia impede duplicacao por usuario e evento.

Estados: `PENDING`, `PROCESSING`, `SENT` e `FAILED`. Falhas transitam para nova tentativa com backoff exponencial limitado; depois de `EMAIL_MAX_ATTEMPTS`, permanecem `FAILED`. Um lock abandonado por mais de dez minutos pode ser retomado. O erro persistido e um codigo sanitizado, nunca a mensagem do servidor ou o conteudo do e-mail. O health do worker exige heartbeat recente apos acesso bem-sucedido a outbox.

O processamento oferece entrega pelo menos uma vez. A idempotencia impede jobs duplicados no banco; uma queda entre a confirmacao do provedor SMTP e o registro `SENT` pode exigir reconciliacao operacional do provedor.

## Configuracao

```env
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=DevFlow <devflow@example.com>
SMTP_REPLY_TO=support@example.com
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=15000
EMAIL_MAX_ATTEMPTS=5
EMAIL_WORKER_BATCH_SIZE=20
EMAIL_VERIFICATION_TTL_MINUTES=30
PASSWORD_RESET_TTL_MINUTES=30
```

`SMTP_SECURE=true` usa TLS implicito, normalmente na porta 465. Com `false`, o transport exige upgrade TLS. O arquivo real continua em `/opt/devflow/config/devflow.env`, modo `0600`; nao coloque credenciais no Git.

O Super Admin pode administrar host, porta, modo TLS, usuario, remetente e timeout em Sistema > Servidor SMTP. A senha e cifrada no PostgreSQL com AES-256-GCM usando `CONFIG_ENCRYPTION_KEY`; o GET retorna apenas `has_password`, nunca o segredo. Se ainda nao houver configuracao persistente, as variaveis protegidas acima servem como fallback. O teste valida a conexao e envia uma mensagem diretamente, com rate limit e diagnostico sanitizado por fase (`verify` ou `send`). As rotas de gravacao e teste exigem sessao Super Admin e CSRF.

## Recuperacao

`POST /api/auth/password/forgot` sempre retorna a mesma mensagem. Para uma conta ativa, invalida tokens anteriores, cria 32 bytes aleatorios, persiste somente o hash SHA-256 e enfileira o link cifrado. `POST /api/auth/password/reset` aceita uma unica vez antes da expiracao, atualiza o hash Argon2id da senha, incrementa `token_version`, revoga todas as sessoes e audita a operacao. Ambos usam rate limit; senhas nunca sao enviadas por e-mail.

## Preferencias e autorizacao

Notificacoes internas e por e-mail, movimentacoes, atribuicoes e atrasos podem ser ajustados no perfil. Eventos criticos de seguranca permanecem obrigatorios. Roadmap continua limitado ao criador e administradores; atribuicoes so sao notificadas ao sair do Roadmap. Links internos usam caminhos relativos controlados e a API reaplica o predicado de visibilidade ao listar.

## Homologacao pendente

Na VPS, validar migrations 006 e 008, health do `devflow-worker`, SMTP real, TLS, timeout, teste direto, indisponibilidade, retry, entrega, recuperacao expirada/usada, preferencias, Roadmap e ausencia de segredos nos logs. Esses testes nao foram executados no Windows.
