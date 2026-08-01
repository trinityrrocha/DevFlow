# Padrões de desenvolvimento

## 1. Linguagem e módulos

- Backend em JavaScript Node.js com CommonJS na primeira fase.
- Frontend em JavaScript/JSX com ESM.
- Migração para TypeScript exige ADR; não deve haver mistura incidental.
- Node LTS e versões de dependências fixadas por lockfile.

## 2. Nomes

- arquivos backend: `camelCase.js`;
- componentes React: `PascalCase.jsx`;
- hooks: `useNome.js`;
- tabelas/colunas: `snake_case`;
- variáveis de ambiente: `UPPER_SNAKE_CASE`;
- endpoints: substantivos em kebab-case quando necessário;
- eventos de auditoria: `snake_case` no passado ou ação clara.

## 3. Backend

### Rotas

- somente path, middleware e controller;
- middleware na ordem: limites, autenticação, autorização, parsing específico;
- nenhuma regra de negócio inline.

### Controllers

- validar contrato;
- chamar um caso de uso;
- mapear erro conhecido;
- retornar resposta;
- não executar SQL;
- não logar body sensível.

### Services

- caso de uso explícito;
- transação recebida ou criada em um único ponto;
- dependências injetáveis quando facilitarem teste;
- autorização por política reutilizável;
- erro com `code` estável e mensagem pública separada.

### Banco

- SQL parametrizado;
- migrations numeradas;
- constraints para invariantes;
- índices definidos com o caso de consulta;
- timezone explícito;
- `SELECT ... FOR UPDATE` para invariantes concorrentes;
- rollback obrigatório em `catch`.

## 4. Frontend

- componentes funcionais;
- página coordena, feature executa, shared component apresenta;
- estado sensível limpo em logout, lock, unmount e timeout;
- nenhum token de sessão em `localStorage` ou `sessionStorage`;
- chamadas HTTP apenas por service;
- erro global para 401, 413 e 429;
- loading, vazio, erro e sucesso em toda operação assíncrona;
- controle icônico exige `title` e `aria-label`.

## 5. CSS e design

- Tailwind como linguagem principal;
- tokens semânticos documentados;
- evitar valores arbitrários repetidos;
- mobile-first;
- foco visível;
- `prefers-reduced-motion` respeitado;
- nenhum botão destrutivo usando cor primária.

## 6. Segurança de código

- validação server-side sempre;
- allowlist em vez de denylist;
- comparações de segredo em tempo constante;
- aleatoriedade por API criptográfica;
- limite de tamanho antes do parsing;
- arquivos em diretório próprio, nome gerado e permissão restrita;
- logs sanitizados;
- erro de produção não expõe stack, SQL ou provider response.

## 7. Testes

Pirâmide mínima:

- unitários para políticas e utilitários;
- integração para banco, sessão, permissões e migrations;
- contrato para API;
- componentes para estados críticos;
- E2E para login, MFA, exclusão, backup, restore e update;
- testes de coexistência para infraestrutura.

Toda correção de bug inclui teste que falhava antes.

## 8. Qualidade

Gates planejados:

- format;
- lint;
- testes backend;
- testes frontend;
- integração com PostgreSQL;
- build;
- validação Compose/Nginx;
- scan de dependências e imagem;
- verificação de segredos;
- documentação sem links quebrados.

## 9. Git

- branch principal `main`;
- branches de trabalho com prefixo `codex/` quando criadas pelo Codex;
- commits pequenos e intencionais;
- nenhuma credencial no histórico;
- migrations não são reescritas depois de publicadas;
- publicação e PRs na identidade autorizada `trinityrrocha`.

## 10. Definition of Done

- requisito aceito;
- código em camada correta;
- autorização e auditoria;
- testes positivos e negativos;
- migration reversível operacionalmente;
- documentação atualizada;
- impacto de backup/update analisado;
- acessibilidade e responsividade verificadas;
- coexistência não degradada.
