# Análise arquitetural do Full Password

## 1. Escopo e método

A análise foi realizada sobre `trinityrrocha/fullpassword`, branch `main`, commit
`804008b5df5d0931ec5d95227fed44086f430d76`.

Foram inventariados 207 arquivos rastreados, aproximadamente 1,55 MB e 32 mil linhas de texto. A leitura cobriu documentação, manifests, Dockerfiles, Compose, Nginx, instalador, atualizador, banco, migrations, backend, frontend e testes. O PNG de interface foi tratado como ativo binário; os demais arquivos rastreados foram incluídos no inventário de texto e na inspeção estática.

O repositório de referência permaneceu isolado. Nenhum arquivo foi criado, editado, formatado, instalado ou executado dentro dele.

## 2. Visão geral

O Full Password é um monorepo de aplicação web:

```text
frontend (React/Vite/Tailwind)
        │ HTTPS + JSON
        ▼
nginx de borda
        │ /api
        ▼
backend (Node/Express)
        │ SQL parametrizado
        ▼
PostgreSQL 15
```

O sistema adiciona um container `updater` com acesso ao socket Docker e ao checkout do projeto, além de volumes próprios para pedidos de atualização e arquivos de backup.

## 3. Organização do código

### 3.1 Raiz

- `backend/`: API, autenticação, autorização, backup e integrações.
- `frontend/`: SPA React e criptografia no navegador.
- `database/`: schema inicial e migrations SQL numeradas.
- `docker/`: configuração Nginx de borda.
- `scripts/`: instalação, daemon e atualização.
- `docker-compose.yml`: PostgreSQL, backend, updater, frontend e Nginx.

### 3.2 Backend

O backend usa CommonJS e separação por responsabilidade:

- `config/`: banco, parâmetros criptográficos, limites de backup e bootstrap de schema.
- `routes/`: roteamento HTTP e composição de middleware.
- `controllers/`: validação de entrada, resposta HTTP e orquestração.
- `services/`: regras reutilizáveis, criptografia de configuração, sessão, MFA, acesso, backup e provedores remotos.
- `middleware/`: autenticação, CSRF, IP/CIDR, tamanho de payload e rate limiting.
- `utils/`: utilitários pequenos e logger sanitizado.
- `scripts/`: testes operacionais e bootstrap do Super Admin.

O `server.js` aplica controles globais antes de montar as rotas: Helmet, CORS restrito, cookies, limitadores, IP, CSRF, limites de corpo e tratamento sanitizado de erros.

### 3.3 Frontend

O frontend usa ESM, componentes funcionais e hooks:

- `pages/`: orquestração de tela e fluxo.
- `components/`: controles e módulos operacionais.
- `layouts/`: shell autenticado e navegação.
- `context/`: autenticação e chaves mantidas em memória.
- `services/`: API, criptografia e identidade criptográfica.
- `hooks/`: limpeza coordenada ao bloquear o cofre.
- `utils/`: clipboard, anexos, validações e proteção de tela.

O padrão predominante é página como coordenadora, componente por domínio visual e serviço para comunicação ou criptografia. Existem componentes grandes nos módulos operacionais; isso deve ser evitado no DevFlow por decomposição antecipada.

### 3.4 Banco

O banco usa UUID para entidades principais, tabelas de associação e chaves estrangeiras com políticas explícitas. O schema inicial é complementado por 17 migrations e por um bootstrap idempotente no backend protegido por advisory lock.

Grupos de tabelas observados:

- identidade: `users`, `groups`, `user_groups`;
- recursos: `clients`, `client_group_access`;
- conteúdo protegido: `vault_items`, `vault_shares`, `client_key_shares`;
- segurança: sessões, MFA, reset, política de senha, IP e auditoria;
- configuração: SMTP e proteção de tela;
- backup: configuração, provedores, execuções e OAuth state.

Há triggers para impedir rebaixamento/desativação do Super Admin e para limpar a obrigação de troca após mudança do hash da senha.

## 4. Segurança observada

### 4.1 Autenticação

- Senha de login com Argon2id.
- JWT assinado, transportado em cookie `fp_session`.
- Cookie `HttpOnly`, `Secure` em produção, `SameSite=Strict` e escopo `/`.
- Sessão persistida no banco pelo hash SHA-256 do token.
- Expiração absoluta de 12 horas e ociosidade de 1 hora.
- Renovação de `last_seen` limitada a intervalos de 5 minutos.
- `token_version` permite revogação global após mudanças sensíveis.
- Conta inativa, sessão revogada e troca obrigatória são verificadas no backend.

### 4.2 MFA

- TOTP com desafio JWT de cinco minutos e audience própria.
- Segredo TOTP cifrado com AES-256-GCM e chave derivada do `JWT_SECRET`.
- Dez códigos de recuperação; apenas hashes Argon2id são armazenados.
- Código de recuperação tem uso único e consumo transacional.
- MFA pode ser obrigatório por usuário e administrado apenas pelo Super Admin.

### 4.3 CSRF, origem e headers

- Double-submit: cookie CSRF legível pelo frontend e header `X-CSRF-Token`.
- Token CSRF possui HMAC e comparação em tempo constante.
- Métodos seguros e endpoints pré-autenticação têm exceções explícitas.
- CORS permite somente `APP_ORIGIN` e credenciais.
- Helmet e Nginx aplicam CSP, HSTS, frame denial, nosniff, referrer e permissions policy.

### 4.4 Criptografia

- Dados de cofre são criptografados no navegador com AES-256-GCM.
- PBKDF2-SHA-256 versionado: 100 mil iterações legadas e 310 mil atuais.
- Chave mestre é desenvelopada no navegador e mantida apenas em memória.
- RSA-OAEP é usado no compartilhamento: 2048 bits legado e 3072 bits atual.
- Chave privada é armazenada somente cifrada.
- Segredos de configuração usam envelope AES-256-GCM e `CONFIG_ENCRYPTION_KEY` base64 de 32 bytes.
- Backup usa scrypt (`N=32768`, `r=8`, `p=1`) e AES-256-GCM.

### 4.5 Autorização

- Papéis `admin` e `user`, com flag persistida `is_super_admin`.
- Grupos concedem `can_view`, `can_edit`, `can_add` e `can_delete`.
- Dono e Super Admin recebem acesso total.
- O backend valida acesso por recurso; o frontend replica o estado apenas para UX.
- Negação de leitura pode responder 404 para reduzir enumeração.

### 4.6 Auditoria e logs

- Eventos de sistema registram usuário, e-mail, ação, status, IP, user-agent, metadados e horário.
- Auditoria específica registra acesso ao cofre.
- Filtros, paginação e limite de metadados reduzem respostas excessivas.
- `safeLogger` evita mensagem arbitrária e stack em produção.
- Operações de login, sessão, MFA, CSRF, backup, update e regras de IP geram eventos.

### 4.7 Proteção contra exclusões

- Exclusão de usuário é restrita ao Super Admin.
- Exige a confirmação textual `EXCLUIR`.
- Autoexclusão e remoção do Super Admin são bloqueadas.
- O último administrador ativo não pode ser removido.
- Trigger de banco protege a identidade do Super Admin.
- Exclusões de módulos exigem confirmação e transação.
- Chaves estrangeiras definem cascata ou `SET NULL`.

Ponto a adaptar: grupos e clientes usam exclusão física em alguns fluxos. O DevFlow adotará soft delete e janela de recuperação quando a regra de negócio permitir.

## 5. Infraestrutura observada

### 5.1 Compose

Serviços:

- `db`: `postgres:15-alpine`, volume `pgdata`, healthcheck e porta apenas interna;
- `backend`: Node 20 Alpine, porta interna 3000;
- `frontend`: build Vite e Nginx estático;
- `updater`: imagem do backend, socket Docker e checkout montado;
- `nginx`: borda nas portas 80 e 443, certificados do host em modo somente leitura.

Nomes de containers, rede e volumes usam o prefixo `fullpassword`, evitando colisões lógicas com o DevFlow.

### 5.2 Nginx e HTTPS

- HTTP redireciona para HTTPS na configuração runtime.
- TLS 1.2/1.3 e certificados Let's Encrypt.
- `/` aponta ao frontend; `/api/` ao backend.
- Restore tem limite e timeout próprios, streaming e buffering desativado.
- O backend não publica porta diretamente no host.

### 5.3 Instalação atual

O instalador:

1. exige root;
2. coleta domínio, e-mail e porta SSH;
3. instala pacotes, Docker, Compose e Certbot;
4. gera segredos;
5. configura UFW e Fail2Ban;
6. clona em `/opt/fullpassword`;
7. emite certificado standalone;
8. gera Nginx runtime;
9. sobe Compose e cria o Super Admin.

Limitações para coexistência:

- `ufw --force reset`;
- sobrescrita de `/etc/fail2ban/jail.local`;
- parada e desativação do Nginx do host;
- Nginx próprio ocupando 80/443;
- certificado standalone exige liberar a porta 80;
- configuração orientada a servidor exclusivo.

Esses comportamentos não serão reproduzidos pelo DevFlow.

## 6. WebUpdater observado

Fluxo real:

1. somente Super Admin solicita atualização;
2. backend grava um JSON com UUID, permissões `0600` e rename atômico;
3. daemon valida tipo, tamanho, chaves e identificadores;
4. lock de diretório impede atualização concorrente;
5. origem Git é limitada ao repositório oficial;
6. árvore rastreada suja bloqueia o processo;
7. branch é fixa em `main` e o pull é `--ff-only`;
8. apenas serviços permitidos são reconstruídos;
9. pedidos e logs vão para diretórios `processed` ou `failed`.

Lacunas confirmadas no código:

- não há backup automático antes da atualização;
- não há release anterior imutável;
- não há healthcheck pós-deploy como gate do updater;
- não há rollback automático de código, imagem ou banco;
- a configuração runtime do Nginx é regenerada e pode remover extensões externas.

Backup pré-restore e rollback transacional de restauração existem, mas não fazem parte do WebUpdater.

## 7. Backup e restauração observados

### V1

- envelope JSON `.enc.json`;
- scrypt + AES-256-GCM;
- limite legado de 50 MB;
- validação estrita de formato, versão e tabelas.

### V2

- ZIP com `manifest.json`, partes cifradas e `checksums.sha256`;
- banco em NDJSON particionado;
- IV único por parte, checksum SHA-256 e HMAC do manifesto;
- proteção contra path traversal, links simbólicos, duplicidade, zip bomb e tamanhos excessivos;
- anexos permanecem embutidos nos dados cifrados do cofre.

### Restauração

- dry-run antes da mutação;
- somente Super Admin;
- confirmação `RESTAURAR BACKUP`;
- backup automático pré-restore com permissão `0600`;
- delete/insert dentro de uma transação;
- `ROLLBACK` em falha;
- conferência de contagem e ajuste de sequences;
- sessões não fazem parte do backup e ficam invalidadas.

### Agendamento remoto

- scheduler singleton com advisory lock;
- tick a cada 30 segundos e timezone configurável;
- deduplicação por slot;
- retenção de 7, 15, 30 ou 60 dias;
- Google Drive, S3 compatível e FTP/FTPS;
- credenciais cifradas e notificações sanitizadas.

## 8. Interface e experiência

### Identidade

- fundo `slate-50`/`gray-50`;
- superfícies brancas;
- navegação `slate-900`;
- ação primária `indigo-600`, hover `indigo-700`;
- texto principal `slate-900`, secundário `slate-500/600/700`;
- vermelho para destrutivo, âmbar para alerta e verde para sucesso.

### Tipografia e densidade

- fonte sans padrão do Tailwind;
- `text-sm` e `font-medium` predominantes;
- cards compactos, campos entre 32 e 40 px;
- `rounded-md`, `rounded-lg`, `shadow-sm` e borda `slate-200/300`;
- conteúdo autenticado com padding 16 px no mobile e 32 px no desktop.

### Componentes

- sidebar fixa de 256 px no desktop e menu overlay no mobile;
- cards, accordions exclusivos, tabelas compactas, tabs e modais;
- Lucide React como biblioteca de ícones;
- senha mascarada, copiar, revelar por 30 segundos e gerador criptográfico;
- loading com spinner, estados vazios, alertas inline e feedback “Copiado!”;
- confirmações destrutivas visíveis e textuais.

### Movimento e acessibilidade

- transições curtas de cor/transformação;
- animação de spinner e fades discretos;
- `aria-label`, `role=dialog`, `aria-modal` e títulos em controles icônicos;
- responsividade mobile-first;
- proteção de tela best-effort ao ocultar, imprimir ou usar atalhos.

## 9. Decisões para o DevFlow

| Padrão | Decisão | Motivo |
|---|---|---|
| Monorepo frontend/backend/database | Manter | Operação simples e contratos próximos |
| React/Vite/Tailwind/Lucide | Manter | Consistência visual |
| Node/Express/PostgreSQL | Manter | Filosofia e operação comuns |
| Controllers/services/middleware/routes | Manter | Separação clara |
| Cookie de sessão + CSRF + sessão no banco | Manter | Boa revogação e menor exposição |
| Autorização no backend | Manter | Controle efetivo |
| Auditoria e logger sanitizado | Manter | Operação segura |
| Backup V2 com manifesto/checksum | Adaptar | Base sólida; separar dados DevFlow |
| Container Nginx ocupando 80/443 | Adaptar | Precisa coexistir com outros sistemas |
| Reset global de UFW/Fail2Ban | Rejeitar | Viola não interrupção |
| Update in-place por `git pull` | Rejeitar | Não permite rollback confiável |
| Container com Docker socket amplo | Adaptar | Reduzir privilégio e superfície |
| Componentes frontend muito grandes | Adaptar | Melhorar testabilidade e manutenção |
