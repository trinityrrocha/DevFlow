# Sistema visual e experiência

## 1. Direção

O DevFlow deve parecer parte da mesma família do Full Password: interface sóbria, compacta, segura e operacional. A identidade será consistente, mas o nome, ícones de produto e conteúdo pertencem ao DevFlow.

## 2. Paleta

| Uso | Token de referência |
|---|---|
| Fundo da aplicação | `slate-50` |
| Superfície | `white` |
| Navegação | `slate-900` |
| Borda suave | `slate-200` |
| Borda de campo | `slate-300` |
| Texto principal | `slate-900` |
| Texto secundário | `slate-500` / `slate-600` / `slate-700` |
| Primária | `indigo-600` |
| Hover primário | `indigo-700` |
| Informação suave | `indigo-50` |
| Perigo | `red-600`, fundo `red-50` |
| Alerta | `amber-800`, fundo `amber-50` |
| Sucesso | `green-800`, fundo `green-50` |

Contraste WCAG AA é obrigatório. Cor nunca é o único indicador.

## 3. Tipografia

- família sans do sistema;
- corpo e controles: 14 px;
- auxílio: 12 px;
- título de seção: 18–24 px;
- peso `medium` para controles;
- `semibold` para títulos;
- line-height confortável em mensagens longas.

## 4. Espaçamento

Escala Tailwind de 4 px:

- 4/8 px entre ícone e texto;
- 12/16 px dentro de controles compactos;
- 24 px dentro de cards;
- 16 px de margem no mobile;
- 32 px de margem no desktop;
- 24 px entre seções.

## 5. Forma e elevação

- campos e botões: `rounded-md`;
- cards e modais: `rounded-lg`;
- cards comuns: `shadow-sm`;
- modais: `shadow-xl`;
- bordas explícitas para manter leitura sem depender da sombra.

## 6. Layout autenticado

- sidebar desktop de 256 px;
- header mobile de 64 px;
- item ativo em índigo;
- menu mobile em overlay;
- conteúdo com largura adequada ao caso: formulários entre 640 e 800 px, páginas de dados até 1280 px;
- header de página com título, descrição e ações.

## 7. Componentes obrigatórios

- `Button`: primary, secondary, ghost e danger.
- `IconButton`: 36 px, tooltip, `aria-label`.
- `Field`: label, help, error e required.
- `SecureField`: mascarar, copiar e revelar temporariamente.
- `Card` e `AccordionCard`.
- `Table`: compacta, responsiva e com estado vazio.
- `Tabs`.
- `Modal` com foco preso, Escape e restauração de foco.
- `Alert`: info, success, warning e error.
- `Badge`.
- `Spinner` e progresso.
- `TypedConfirmation` para ação destrutiva.

## 8. Comportamentos

- apenas um accordion de configurações aberto por grupo;
- copiar mostra feedback por cerca de um segundo;
- segredo revelado volta a ficar oculto automaticamente;
- loading desabilita envio duplicado;
- fechamento de modal limpa estado sensível;
- operações demoradas mostram progresso real quando disponível;
- erro indica ação corretiva sem expor detalhe interno;
- ações destrutivas exibem nome e impacto.

## 9. Animação

- 120–200 ms;
- cor, opacidade e rotação discretas;
- spinner apenas durante espera real;
- sem movimento decorativo em telas críticas;
- reduzir/desativar com `prefers-reduced-motion`.

## 10. Responsividade

- mobile-first;
- tabela vira cards ou scroll com cabeçalho preservado;
- ações permanecem alcançáveis por toque;
- área clicável mínima de 40 px, preferencialmente 44 px;
- modais usam no máximo 90% da viewport.

## 11. Acessibilidade

- HTML semântico;
- label ligado ao campo;
- foco visível;
- ordem de tab coerente;
- diálogo com nome acessível;
- ícones decorativos ocultos de leitor de tela;
- mensagens dinâmicas com `aria-live`;
- navegação e ações completas por teclado.

## 12. Proteção visual

Blur ao ocultar a página, bloqueio de impressão e interceptação de atalhos são medidas best-effort, não controles absolutos. O produto deve explicar essa limitação e nunca substituir criptografia, autorização ou política de endpoint por proteção visual.
