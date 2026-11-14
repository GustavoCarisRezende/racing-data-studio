# Revisão final do Sandbox — 14/11/2026

## Entregue

- Modelos padrão e do usuário compartilham a lista persistida e cartões
  recolhíveis. Padrões F1 recebem marca discreta pelos IDs exatos reservados no
  host, não pelos nomes; edição e exclusão confirmada funcionam igualmente.
  Edição abre o modelo completo; não há edição inline do nome no cartão.
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
- CSV completo com vírgulas, ordenação da tabela, proteção de fórmulas e manifesto
  de fontes/licenças. Exportação experimental de SVG, PNG transparente e JPEG
  com opções de legenda e rótulos, e salvamento por seletor nativo sem aceitar
  caminho enviado pelo frontend. Nenhum arquivo existente é sobrescrito.

## Pendências e limites importantes

- **Organizar linhas da tabela não recalcula totais**; use a ação separada
  **Recalcular totais da tabela**. A ação aplica a agregação selecionada sobre
  dados filtrados, não soma valores previamente agrupados. Filtros antes aplicados
  somente à exibição de acumulados passam a limitar a entrada da nova consulta.
  O resultado não é classificação oficial e dados ausentes não viram zero.
- A marca de padrão reflete o ID reservado pelo host, não é prova criptográfica
  de origem e não protege o registro de edição/exclusão. Se um armazenamento
  externo reutilizar intencionalmente um ID reservado, ele receberá a mesma marca.
- Exportações de imagem e diálogo nativo foram testadas por SVG ECharts real,
  Canvas simulado e escrita temporária; **não** houve validação no WebView, no
  seletor real, da transparência efetiva ou da fidelidade visual. O layout da
  imagem é fixo e pode diferir da tela. O comando nativo verifica assinatura e
  limites, não é um sanitizador de SVG arbitrário.
- O manifesto exportado inclui filtros e revisões; arquivos são locais, mas
  devem ser compartilhados conscientemente. CSV e manifesto exigem dois diálogos;
  cancelar/falhar no segundo pode deixar o primeiro salvo.
- Versões anteriores do aplicativo podem falhar ao listar modelos com novas
  configurações de pizza/tabela ou agregações. Modelos existentes não são
  automaticamente convertidos nem regravados; não há downgrade automático.
- Modo de visualização não substitui o tratamento de navegação externa do host;
  o host deve respeitar `onDirtyChange`. Nenhum teste comprova acessibilidade
  completa, IPC real, concorrência no banco pessoal ou grandes históricos.

## Verificação desta revisão

Testes Node sequenciais com `NODE_OPTIONS=--max-old-space-size=1024`, sem
`ulimit -v`, e timeout: `app/tests/analysis.test.mjs` (15), `export-service`
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
