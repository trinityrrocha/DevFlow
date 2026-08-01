# Documento 002 — Especificação funcional do DevFlow

## 1. Status

Documento aprovado como referência funcional em 2026-07-28.

Este documento complementa o Documento 001. Em caso de conflito:

1. segurança, isolamento e não interrupção definidos no Documento 001 permanecem obrigatórios;
2. regras funcionais e fluxos deste documento orientam o domínio;
3. decisões provisórias abaixo podem ser ajustadas por configuração sem apagar histórico.

## 2. Objetivo

O DevFlow controla a jornada completa de uma demanda de software, desde a entrada até produção. O sistema preserva contexto, decisões, testes, evidências, tempo, responsáveis, qualidade e histórico.

## 3. Perfis

### Níveis de acesso

- `ADMIN`: administração de usuários, fluxo e cadastros.
- `USER`: execução das atividades autorizadas.

### Perfis técnicos

- `BACKEND_DEVELOPER`;
- `FRONTEND_DEVELOPER`;
- `MANAGER`.

Perfis são registros de banco, não enum rígido, permitindo QA, DevOps, UX/UI, Product Owner e Suporte sem migration estrutural.

## 4. Tipos de demanda

### Solicitação

Campos obrigatórios:

- título;
- descrição inicial;
- solicitante;
- prioridade;
- tipo;
- ambiente;
- responsável Backend;
- responsável Frontend.

Anexos iniciais são permitidos, mas não obrigatórios.

### Bug

Campos obrigatórios:

- produto afetado;
- requisito relacionado;
- descrição;
- prioridade;
- ambiente;
- evidências;
- solicitante;
- responsável Backend;
- responsável Frontend.

Anexos são permitidos. Classificação `BACKEND`, `FRONTEND` ou `BOTH` determina atribuição de impacto de qualidade.

## 5. Catálogos

### Prioridade

- baixa;
- média;
- alta;
- crítica;
- urgente produção.

### Tipo de solicitação

- nova funcionalidade;
- melhoria;
- ajuste visual;
- performance;
- refatoração;
- correção;
- integração;
- documentação;
- outro.

### Ambiente

- desenvolvimento;
- homologação;
- produção;
- cliente específico;
- ambiente local.

Quando o ambiente for cliente específico, o nome ou identificador do cliente é obrigatório.

## 6. Workflow

Solicitação:

```text
Roadmap -> Backend -> Frontend -> Update GitHub -> Testando -> Revisando -> Produção
```

Bug:

```text
Report Bug -> Backend -> Frontend -> Update GitHub -> Testando -> Revisando -> Produção
```

Cada transição cria um evento imutável com etapa anterior, etapa nova, ator, horário e observação.

### Requisitos provisórios de avanço

| Etapa atual | Requisitos |
|---|---|
| Roadmap / Report Bug | dados obrigatórios e responsáveis válidos |
| Backend | ao menos um teste Backend, resultado e informação técnica |
| Frontend | ao menos um teste Frontend, resultado e observação |
| Update GitHub | repositório, branch e commit |
| Testando | teste QA, resultado, evidência e aprovação |
| Revisando | decisão aprovada e observação |
| Produção | etapa terminal; marca conclusão |

O backend retorna uma lista de pendências. O frontend apenas apresenta essa lista.

Administradores podem avançar ou retroceder, mas não ignoram requisitos sem registrar uma justificativa de override. O primeiro incremento não oferece override silencioso.

## 7. Estados administrativos

- ativa;
- pausada;
- cancelada;
- concluída.

Pausar congela os cronômetros. Reabrir cria novo intervalo e preserva o ciclo anterior. Cancelar exige motivo. Exclusão física de tarefa, comentário, teste, anexo ou evento não é permitida pela aplicação.

## 8. Tempo

- O tempo total começa quando a demanda sai da etapa de entrada.
- O tempo da etapa começa ao entrar em uma etapa ativa.
- Mudar de etapa encerra o intervalo anterior e inicia outro.
- Pausar encerra o intervalo aberto; reabrir inicia novo intervalo na mesma etapa.
- O tempo total exclui períodos pausados.
- Retrocesso cria um novo intervalo para a etapa, sem alterar os anteriores.

As durações são derivadas de intervalos persistidos, nunca de um contador mantido apenas no navegador.

## 9. Card da tarefa

Abas:

- Resumo;
- Testes;
- GitHub;
- Anexos;
- Comentários;
- Histórico.

O resumo apresenta dados gerais, status, etapa, responsáveis, prioridade, ambiente, datas e tempos.

## 10. Testes e revisão

Cada registro de teste possui:

- contexto/etapa;
- descrição;
- resultado `PASSED`, `FAILED` ou `BLOCKED`;
- evidência textual;
- ator e horário.

Registros são append-only. Correções criam um novo teste.

Aprovação e reprovação também são eventos append-only. Uma reprovação pode provocar retrocesso, aumentando o contador de retrabalho.

## 11. GitHub

O primeiro incremento armazena:

- URL do repositório;
- branch;
- commit;
- pull request;
- release.

Não há integração externa automática nesta fase. Os campos já formam um contrato preparado para o plugin GitHub futuro.

## 12. Anexos

Tipos previstos:

- imagens;
- PDFs;
- vídeos;
- documentos;
- compactados.

O arquivo recebe nome interno aleatório, checksum, MIME detectado/validado, tamanho, autor e vínculo. Remoção lógica preserva metadados e auditoria. Limites exatos ficam em configuração.

## 13. Notificações

Ao mudar de etapa:

- cria notificação interna para o próximo responsável;
- incrementa indicador visual;
- tenta envio de e-mail quando SMTP estiver configurado;
- falha de e-mail não reverte a transição, mas é auditada e pode ser reenviada.

## 14. Dashboard

Métricas gerais:

- totais por estado;
- bugs resolvidos e pendentes;
- média de conclusão;
- média por etapa;
- distribuição por prioridade, ambiente e tipo.

Métricas por desenvolvedor:

- concluídas;
- bugs corrigidos;
- média por tarefa e etapa;
- tempo ativo;
- produtividade;
- ranking;
- taxa de aprovação;
- retrabalhos;
- índice de qualidade.

Atualização “em tempo real” no primeiro incremento significa refresh após mutações e polling de 15 segundos. SSE/WebSocket poderá substituir o polling sem alterar contratos.

## 15. Fórmulas provisórias

As fórmulas são versionadas e exibidas com transparência.

### Taxa de aprovação

```text
aprovações / (aprovações + reprovações) * 100
```

### Índice de qualidade

```text
100
- 15 por reprovação
- 10 por retrabalho
- 8 por bug gerado e atribuído
+ 3 por bug corrigido
```

Resultado limitado entre 0 e 100. Bugs Frontend afetam o responsável Frontend da tarefa relacionada; Backend afetam Backend; `BOTH` afeta ambos.

### Produtividade

Pontuação de entregas concluídas ponderada por prioridade, ajustada pela taxa de aprovação. O ranking nunca deve ser usado isoladamente para avaliação humana.

Pesos iniciais: baixa 1, média 2, alta 3, crítica 5, urgente produção 8.

## 16. Auditoria e histórico

Toda mutação registra:

- usuário;
- data/hora UTC;
- IP quando aplicável;
- request ID;
- operação;
- valores anteriores;
- valores novos.

Dados históricos são append-only. Redações exigidas por lei devem preservar um tombstone e o motivo, com acesso administrativo auditado.

## 17. Critérios de aceite do primeiro incremento

- autenticação e usuários;
- criação de solicitação e bug;
- filtros e lista;
- detalhe com todas as abas;
- transições bloqueadas por requisitos;
- pausa, reabertura e cancelamento;
- cronômetros derivados do servidor;
- testes, comentários e metadados GitHub;
- anexos;
- notificações internas e e-mail configurável;
- dashboard geral e por desenvolvedor;
- histórico/auditoria imutáveis;
- backup e infraestrutura compatíveis com Documento 001.
