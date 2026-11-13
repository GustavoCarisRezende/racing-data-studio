# Sandbox biblioteca — handoff v2 (10/11/2026)

> Para incluir sessões anteriores apesar do recorte por sessão/rodada, usar o
> opt-in [v3 por perfil](SANDBOX_V3_ACCUMULATION.md). Este documento conserva o
> comportamento v2 (somente eixo pós-cálculo), sem reinterpretar modelos antigos.

Implementação limitada a `packages/` e documentação da biblioteca. **Não habilita
capacidades no adapter F1 nem cria persistência nativa.** Não lê o banco do usuário.
Os tipos completos/exportados estão em `packages/sandbox-contracts/src/index.ts`;
validadores runtime em `validation.ts` no mesmo diretório.

## 1. Compatibilidade e versões independentes

| Camada | Versão / regra |
|---|---|
| Catálogo, descriptor, seleção, facetas | `protocolVersion: 1`, com capacidades opcionais |
| Query/result | `1` normalmente; `2` para recorte após cálculo; resposta repete a versão solicitada |
| Análise antiga | `documentVersion: 1`, snapshots fixos, `AnalysisStore` original |
| Modelo | `documentVersion: 2`, `kind: 'model'`, vínculo `latest`, `AnalysisStore.models` |
| Configuração de tabela no modelo | `table.version: 1` |

`PROTOCOL_VERSION` e `DOCUMENT_VERSION` continuam `1` para consumidores antigos.
`MODEL_DOCUMENT_VERSION` é `2`. Ausência de `models`/novas capacidades mantém a
integração antiga. Não há migration automática, regravação ao abrir, autosave ou
conversão de análise fixa em modelo. V1 não aceita pizza/dispersão nem
`secondaryMetric`, `table` ou `cumulativeScope`: salvar esses recursos exige modelo.
Versões futuras e alterações de schema/semântica são rejeitadas, não reinterpretadas.

Uma análise antiga preserva seus filtros e agrupamento, mesmo se o descriptor passou
a oferecer multisseleção. O caminho React de abertura v1 usa
`buildQuery(..., { legacyPinned: true })`. Para **novas** consultas, `buildQuery`
recusa omitir a dimensão de multisseleção. `withRequiredDimensions` preserva essa
dimensão ao criar/editar configurações. A primeira edição explícita de configuração
ou filtros pode portanto adicionar esse agrupamento; abrir sozinho nunca o adiciona.
`assertQuery` não impõe esse hint retroativamente sobre queries v1 de consumidores
antigos. Regras intrínsecas da métrica continuam em `requiredDimensions` (não mudar
essas regras sem versionar a semântica dos documentos existentes).

## 2. Capacidades que Terra/host devem anunciar

Adições opcionais a `DatasetDescriptor.capabilities`:

```ts
queryVersions?: (1 | 2)[]; // ausente = [1]
runningSumScopes?: ('filteredSelection' | 'beforeDisplayFilter')[];
// ausente = ['filteredSelection']
latestSelection?: boolean;
multiSelection?: { fieldId: string; maxValues: number }; // 2..200
```

Exemplo F1 **somente depois de implementar e testar o provider**:

```ts
charts: ['table', 'line', 'bar', 'pie', 'scatter'],
queryVersions: [1, 2],
runningSum: true,
runningSumScopes: ['filteredSelection', 'beforeDisplayFilter'],
latestSelection: true,
multiSelection: { fieldId: 'season', maxValues: 20 },
comparisonDimensions: ['season'],
// Manter maxDimensions, maxRows, maxSeries e completeGroupedQueries reais.
```

- `latestSelection: true` é uma garantia: **cada** `resolveSelection({policy:'latest'})`
  verifica as revisões locais atuais de forma consistente, em vez de reutilizar o
  catálogo de snapshots carregado no início do processo. Não implica rede/sync.
- `partitionIds: []` significa todas as partições locais elegíveis, incluindo novas
  partições ao reabrir. Lista não vazia restringe o escopo; não pode faltar uma
  partição silenciosamente. Filtros de temporadas são filtros de campo, não IDs de
  partição inferidos pela biblioteca.
- A seleção resolvida fica consistente durante a sessão. Queries e facetas usam
  seu token, **não** alternam para latest a cada chamada. Reabrir um modelo resolve
  latest novamente; não é atualização em tempo real. Proveniência mostra as revisões
  efetivamente utilizadas naquela abertura.
- O campo de multisseleção precisa ser uma dimensão disponível com operador `in`.
  Implementar `facet` com busca/paginação, devolvendo IDs tipados e rótulos da fonte.
  A UI inclui uma faceta pesquisável, não um comparador limitado a dois anos.
  `maxValues` limita valores explicitamente marcados; **Todos** remove a restrição,
  não inventa uma amostra de até N temporadas. Limites da query/gráfico continuam
  aplicáveis. Os outros filtros podem reduzir as opções disponíveis da faceta.
- Preservar temporada na identidade dos grupos e em `window.partitionBy`. Mesmo
  piloto/rodada em anos diferentes não vira uma observação única.
  O hint de multisseleção também autoriza usar esse campo no slot `comparison`,
  mesmo se ele não estiver em `comparisonDimensions`, deixando `series` livre
  para outra dimensão. Não precisa haver conhecimento de temporadas no núcleo.

Não marcar `latestSelection` no provider F1 atual se ele ainda cacheia os snapshots
iniciais. A biblioteca deixa modelos indisponíveis sem essa garantia **e** store v2.

## 3. Pizza e dispersão

`ChartKind` adiciona `'pie' | 'scatter'`. Extensões de `VisualizationSpec`:

```ts
secondaryMetric?: { metricId: string; aggregation: Aggregation };
cumulativeScope?: 'filteredSelection' | 'beforeDisplayFilter';
table?: {
  version: 1;
  columns: string[];
  sort?: { columnId: string; direction: 'asc' | 'desc' };
};
```

Dispersão:
- `x` continua sendo a **dimensão/granularidade da observação**, não uma medida.
  `metric` é a medida numérica **Y**, `secondaryMetric` é a medida numérica **X**.
- `QueryRequest.metrics` contém `[metric, secondaryMetric]`. Retornar as duas colunas
  na mesma linha agrupada, com IDs de saída distintos e tipos validados. Não fazer
  duas queries independentes nem associar medidas por posição de linhas.
- Todas as dimensões precisam ser permitidas por **ambas** as métricas e incluir
  seus `requiredDimensions`. Cada par pode ter sua agregação autorizada própria.
  A UI só oferece dispersão quando existe uma segunda medida compatível.
- Agrupamento/comparação identifica as séries. Cada linha completa é um ponto;
  negativos em X/Y são preservados. Par com qualquer medida nula é omitido, com
  contagem explícita na UI/descrição acessível; a linha exata continua na tabela.

Pizza:
- Uma fatia por chave **completa** de agrupamento (incluindo temporada), sem somar
  anos/grupos no renderer. Rótulos incluem as dimensões da chave.
- Qualquer valor negativo recusa o gráfico (`NEGATIVE_PIE`); não aplica valor
  absoluto. Nulos são omitidos com aviso. Zeros não geram fatias visíveis; total
  zero/nulo recusa o gráfico (`EMPTY_PIE`), sem divisão ou círculo fictício.
- Até `min(maxSeries, 100)` fatias; refinar filtros ou usar tabela quando exceder.

Ambos usam módulos reais `PieChart`/`ScatterChart` do ECharts, SVG, tooltip richText,
sem HTML injetado, fórmulas, plugins executáveis ou opções ECharts de documentos.
Não admitem acumulado. Resultados parciais não viram gráficos. Number é aproximado;
magnitudes acima do limite seguro, Infinity e underflow são recusados. Decimais da
tabela/transporte/exportação permanecem exatos. Dispersão: até 20 mil pontos e
`maxSeries` séries; linha/barra continuam limitadas a 20 mil células.

## 4. Modelos salvos — interface exata

`AnalysisStore` mantém seus métodos v1 e ganha **apenas** `models?: SavedModelStore`.
O host deve usar um namespace/tabela separado, sem enviar v2 ao store nativo v1.

```ts
interface SavedModelDocument {
  documentVersion: 2;
  kind: 'model';
  id: string;
  revision: string | null;
  title: string;
  datasetId: string;
  datasetSchemaVersion: string;
  datasetSemanticVersion: string;
  binding: { policy: 'latest'; partitionIds: string[] };
  visualization: VisualizationSpec;
  filters: Filter[];
  createdAt: string;
  updatedAt: string;
}
interface SavedModelStore {
  documentVersion: 2;
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: SavedModelDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<SavedModelDocument>;
  delete(request: { id: string; expectedRevision: string },
         signal?: AbortSignal): Promise<void>;
}
// AnalysisSummary = { id, revision, title, updatedAt }, todos strings.
```

Regras obrigatórias:
1. `save` cria com `revision === expectedRevision === null` se o ID não existe;
   atualiza/renomeia somente quando as duas revisões coincidem com a persistida.
   Retornar o mesmo conteúdo/timestamps com **nova revision não nula**. A UI valida
   a resposta e recusa store que modifica o conteúdo. CAS deve ser atômico no host.
2. `delete` também faz CAS atômico. Conflito → `SandboxError('CONFLICT', ...)`;
   ausente → `REVISION_MISSING`. Nunca sobrescrever/excluir silenciosamente.
3. O modelo não possui `selection`, token, referências ou linhas de snapshots.
   Validar com `parseModelDocument(raw, descriptor)` no limite do transporte.
   As versões do dataset precisam corresponder; não fazer upgrade silencioso.
4. `list` retorna apenas registros reais (máximo 1000 nesta UI), sem exemplos
   pré-instalados. `load` precisa corresponder ao ID solicitado. AbortSignal deve
   ser respeitado; abortar não promete desfazer uma gravação já confirmada.
5. Criar: **Salvar modelo**; atualizar/renomear: editar configuração/título e
   **Salvar modelo**; duplicar: **Salvar como novo modelo**; excluir: selecionar
   registro e confirmar **Excluir modelo**. O modelo em edição é informado
   separadamente do seletor de abertura/exclusão. **Atualizar lista** não resolve
   dados novamente nem descarta edições. **Abrir** chama latest novamente.
6. Em erro/conflito as edições continuam na memória; não há autosave, merge,
   recuperação de rascunho, revisão histórica de modelos ou backend durável incluso.

`makeModel(d, partitionIds, visualization, filters, title, previous?)` cria/atualiza
o payload. `makeAnalysis` continua exclusivo de análises fixas v1. Salvar como modelo
a partir de uma análise fixa é uma ação explícita, com novo ID e sem alterar a antiga.

`examples/memory-provider.mjs` oferece store CAS **volátil** e reader de fixture
injetado. Dados inventados só existem nos testes/exemplos, nunca no componente
`Sandbox` ou como fallback quando provider/store reais faltam.

## 5. Contrato de acumulados para Terra (F1)

`QueryRequest.protocolVersion: 2` permite `displayFilters?: Filter[]` e
`window.scope: 'beforeDisplayFilter'`. A UI move **somente filtros do eixo `x`**
(rodada) de `filters` para `displayFilters` quando o usuário escolhe esse escopo.
Outros filtros continuam sendo filtros da população de entrada.

Ordem obrigatória no provider:

```text
validar request, versões, capacidades e seleção
→ ler ocorrências das revisões resolvidas
→ aplicar filters (população)
→ agregar por dimensions (uma linha por chave)
→ calcular runningSum em ordem ASC do valor tipado de window.orderBy
  reiniciando por TODOS os campos de window.partitionBy
→ aplicar displayFilters nas dimensões agrupadas
→ ordenar para apresentação por orderBy
→ conferir limit / totalRows / complete e retornar protocolVersion: 2
```

Exemplo ilustrativo dos campos **reais a implementar pelo adapter**:

```ts
dimensions: ['round', 'driver', 'season'],
metrics: [{ metricId: 'points', aggregation: 'sum' }],
filters: [{ fieldId: 'season', op: 'in', values: ['2024', '2025'] }],
displayFilters: [{ fieldId: 'round', op: 'range', min: 5, max: 10 }],
window: {
  kind: 'runningSum', metricId: 'points', orderBy: 'round',
  partitionBy: ['driver', 'season'], scope: 'beforeDisplayFilter',
},
```

Na rodada 5, mostrar o acumulado calculado desde o início do conjunto de entrada,
**incluindo rodadas 1–4**, não a soma iniciada na rodada 5. Rodada 10 inclui 1–10,
não rodadas posteriores. Não aplicar LIMIT antes da janela; ordem de exibição
descendente tampouco inverte a acumulação. Não confundir valores de anos diferentes.
Para F1, agregar as ocorrências de pontos permitidas por piloto/rodada/temporada
antes da janela (por exemplo corrida+sprint, se ambas estiverem na população).
Terra deve definir/testar cobertura esperada, nulos, eventos ausentes e duplicidades
da fonte; ausência não é zero e não deve ser preenchida pela biblioteca.

Filtros por equipe/sessão continuam na entrada: podem excluir parte da carreira
de um piloto ou resultados sprint. Esse total **não é automaticamente classificação
oficial**, nem season-to-date completo se faltam eventos importados. Para outra
semântica de população, criar um contrato explícito, não deslocar esses filtros
silenciosamente para depois da janela.

V1 permanece `scope: 'filteredSelection'`: o filtro de rodada aplica **antes** de
somar. A mesma faixa 5–10 acumula apenas 5–10. Descrever essa diferença e manter os
dois comportamentos testados; não reinterpretar análises v1 já salvas. V2 valida que
o eixo não aparece nos filtros de entrada e que o recorte cumulativo usa esse eixo.
`partitionBy` é obrigatório e completo; ordem deve ser dimensão ordenada; métrica
aditiva, com `supportsRunningSum` e agregação `sum`. Cálculo decimal exato é tarefa
do provider, não do ECharts ou da camada React.

## 6. Tabela e proteção de edições

- Todos os controles de visualização/eixos/métricas ficam **à direita**; não há
  segunda configuração no topo. O centro mantém título, ações, resultado e preview.
- Colunas usam IDs lógicos da query, não traduções/posições DOM. Escolher pelo checkbox;
  reordenar por botões nativos ↑/↓ (Tab + Enter/Espaço) ou Alt+↑/↓ no controle da
  coluna. Pelo menos uma coluna fica visível. Ordem/visibilidade/sort persistem em v2.
- Sort pelo botão do cabeçalho ou editor à direita. `tableRows` ordena estavelmente
  **todas as linhas recebidas antes da paginação** de 50 linhas, com comparação
  decimal exata e nulos por último. Usa valores tipados originais, não rótulos
  traduzidos; não ordena somente a página nem modifica a ordem do gráfico/cálculo.
  Um resultado parcial é identificado; ordenar o preview não o torna completo.
- Campos removidos da query são retirados da configuração; colunas ainda válidas
  mantêm a ordem. Se nenhuma sobreviver, o editor usa as colunas atuais. CSV continua
  exportando o resultado completo com colunas contratuais, não só as colunas visíveis.
- Estado sujo compara título/configuração/filtros à última abertura/gravação. Há
  aviso e confirmação ao abrir análise/modelo, trocar dataset ou aplicar preset.
  Excluir modelo exige confirmação própria; não exclui a configuração na memória.

Adições opcionais a `SandboxHostServices`:

```ts
confirm?: (request: {
  kind: 'discardChanges' | 'deleteModel'; title: string;
}, signal?: AbortSignal) => Promise<boolean>;
onDirtyChange?: (dirty: boolean) => void;
```

Sem `confirm`, a biblioteca mostra confirmação acessível local (Cancelar/Confirmar,
Escape, foco e região externa inerte). Também registra `beforeunload` no browser.
**O shell deve usar `onDirtyChange` para proteger navegação externa, fechamento
Tauri e mudanças deliberadas das props `provider`/`selection`.** A biblioteca não
pode impedir que o host desmonte o componente. `false` é notificado ao desmontar.
Mantenha provider/store/host/selection estáveis entre renders.

## 7. Verificação e limites restantes

Em `packages/`: `npm test`, `npm run build`, `npm run size`. Os testes incluem
v1 golden inalterado, v2 cálculo-antes-recorte, SVG ECharts real de ambos os gráficos,
negativos/nulos/zeros, medidas compatíveis, três campanhas, ordenação decimal,
colunas via teclado, CRUD/CAS, confirmação local e reabertura latest vs pinned.

Não foi implementado aqui: backend/model store durável, mudanças de IPC/Tauri/SQLite,
acumulados F1, atualização do catálogo cacheado F1 ou habilitação de suas capacidades,
telemetria, autosave, refresh de dados em segundo plano, grandes históricos sem
limites, virtualização/streaming ou novos formatos de exportação. Nenhum teste
acessa o banco pessoal. jsdom/SSR não validam layout, contraste, leitor de tela,
WebKitGTK/CSP real ou transações/concorrência do backend nativo; isso cabe à integração.
