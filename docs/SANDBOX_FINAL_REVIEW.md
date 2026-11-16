# Revisão final do Sandbox — 14/11/2026

> **Contexto histórico:** este documento registra uma proposta, contrato ou revisão de seu período; afirmações de estado, pendências e testes não são necessariamente atuais. Para o estado beta e as diferenças de implementação, consulte [desenvolvimento](DEVELOPMENT.md) e [guia beta](BETA.md). O texto histórico abaixo foi preservado. **Atual:** análises legadas também podem ser excluídas no gerenciamento, com confirmação e revisão otimista.

## Entregue

- Modelos padrão e do usuário compartilham a lista persistida em painel próprio,
  sem estrelas. Selecionar abre; editar/excluir ficam à direita do cartão.
  Exclusão exige confirmação; edição abre o modelo completo.
- Modos de visualização e edição, com preservação de rascunhos. Nomes novos ou
  alterados estão limitados a 30 unidades UTF-16; nomes legados maiores podem ser
  mantidos exatamente. Criar uma cópia exige um nome de até 30 unidades.
- Prévia sob o gráfico e painel de métricas/capacidades removidos.
- Pontos F1 aceitam soma, média, mínimo e máximo; ausências propagam e médias
  usam a regra decimal documentada em `SANDBOX_F1_AGGREGATIONS.md`.
- Colunas da tabela podem ser ocultadas e reordenadas por teclado/botões ou
  arrastar; a ordenação de múltiplas colunas é triestado, com prioridades e
  persistência. O nome da rodada usa o calendário da mesma temporada/revisão.
- A ação explícita **Recalcular totais da tabela** troca as dimensões da consulta
  e consulta novamente a fonte, incluindo as dimensões obrigatórias. Por exemplo,
  Piloto preserva Temporada na F1. Os filtros permanecem, mas passam todos a
  filtrar a entrada; acumulados, dimensões extras e configuração da tabela são
  removidos com aviso prévio. O grão é persistido nos campos existentes do modelo
  v2/v3. Isso é separado de organizar visualmente linhas já calculadas.
- Pizza permite ordenação, limiar estritamente menor para “Outros”, apresentado
  por último, e opções de legenda/rótulos. O agrupamento soma valores das fatias
  já calculadas, não recalcula média ou contagem distinta da união.
- CSV da tabela com vírgulas, ordenação e proteção de fórmulas. Gráficos podem ser
  exportados como SVG ou PNG com opção de incluir legenda. O salvamento usa seletor
  local e o frontend não envia caminhos; nenhum arquivo existente é sobrescrito.

## Mudança recente da sandbox

- Ao salvar um modelo, a UI permite atualizar o selecionado ou criar um novo com
  nome, além de escolher se filtros e seleção de dados serão restaurados ao abrir.
  `saveFilters` e `saveDataSelection` são preferências booleanas opcionais no mesmo
  documento v2/v3; ausência mantém a compatibilidade com modelos antigos.
- Filtros e seleção continuam nos campos já existentes: com `saveFilters: false`,
  a biblioteca omite os filtros salvos, exceto o filtro de seleção quando
  `saveDataSelection: true`; com `saveDataSelection: false`,
  `binding.partitionIds` é salvo como `[]`. Não foi criada migration.
- O host valida e faz round-trip das duas preferências. Exportação do host aceita
  um único CSV ou uma imagem SVG/PNG; não exporta manifesto JSON nem JPEG.
- Esta mudança foi verificada por 65 testes da biblioteca, 26 do aplicativo e
  44 testes Rust (um smoke test de rede ignorado), além do build web.
  No Chromium, com dados sintéticos, foram exercitados o painel de modelos,
  carregamento direto, modal bloqueante, isolamento pela legenda e exportações
  SVG/PNG. **O WebView e o diálogo nativo real ainda precisam de validação.**
- Análises antigas aparecem no painel unificado e podem ser abertas e salvas
  como modelos. Sua exclusão permanece indisponível no store legado, com
  explicação na interface; os documentos originais são preservados.

## Pendências e limites importantes

- **Organizar linhas da tabela não recalcula totais**; use a ação separada
  **Recalcular totais da tabela**. A ação aplica a agregação selecionada sobre
  dados filtrados, não soma valores previamente agrupados. Filtros antes aplicados
  somente à exibição de acumulados passam a limitar a entrada da nova consulta.
  O resultado não é classificação oficial e dados ausentes não viram zero.
- Exportação de imagem e diálogo nativo ainda precisam de validação no WebView e
  no seletor real, inclusive transparência e fidelidade visual. O layout da imagem
  é fixo e pode diferir da tela. O comando nativo verifica assinatura e limites,
  não é um sanitizador de SVG arbitrário.
- Versões anteriores do aplicativo podem falhar ao listar modelos com novas
  configurações de pizza/tabela ou agregações. Modelos existentes não são
  automaticamente convertidos nem regravados; não há downgrade automático.
- Modo de visualização não substitui o tratamento de navegação externa do host;
  o host deve respeitar `onDirtyChange`. Nenhum teste comprova acessibilidade
  completa, IPC real, concorrência no banco pessoal ou grandes históricos.

## Verificação desta revisão

Testes Node sequenciais com `NODE_OPTIONS=--max-old-space-size=1024`, sem
`ulimit -v`, e timeout: `app/tests/analysis.test.mjs` (16), `export-service`
(2), e em `packages/tests`: `f1-aggregation` (2), `f1-round-labels` (1),
`usability` (2), `models-ui` (1), `v2` (5), `v3-ui` (1), `pie-options` (1),
`pie-options-ui` (1), `image-export` (2), `table-export` (1) e `ui` (4).
Todos passaram. O teste de análise usa Vite em modo middleware. Nas duas primeiras
execuções, o WebSocket HMR não havia sido explicitamente desativado; o código do
Vite indica que ele podia abrir um listener temporário, encerrado no fechamento do
teste. Isso contrariou a restrição de não iniciar servidores; a afirmação inicial
de que nenhuma porta era aberta foi imprecisa. Foi adicionado `ws: false` e a
última execução passou sem esse listener. Desabilitar também a descoberta de
dependências reduziu o pico medido de ~1 GiB para ~400 MiB na última execução.
Demais testes focados ficaram abaixo de 260 MiB de pico por processo. As medidas
são picos RSS reportados ao término de cada processo, não uma amostragem
contínua de crescimento durante a execução.

Testes Rust isolados `table_v2_tests` (1) e `export_text_tests` (2), com
`CARGO_BUILD_JOBS=1`, passaram usando banco em memória e arquivos temporários.
TypeScript dos dois workspaces e build Vite do app passaram sequencialmente;
Vite manteve aviso de chunk lazy acima de 500 kB. Não foram executadas as suítes
inteiras, navegador, banco pessoal, commit ou push. A ressalva do WebSocket nas
primeiras execuções consta acima.
