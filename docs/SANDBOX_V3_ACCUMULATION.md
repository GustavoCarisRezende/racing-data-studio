# Handoff: acumulados por perfil — query/modelo v3

> A apresentação atual usa o perfil como **métrica selecionável**, não como seletor
> técnico de perfil. Contrato/pipeline v3 abaixo preservados. Ver
> [SANDBOX_UI_RECOVERY.md](SANDBOX_UI_RECOVERY.md) para `measureLabel`, gestão unificada
> e os dois ajustes indispensáveis no host F1.

Extensão da **biblioteca**, em resposta a `F1_SANDBOX_V2_STATUS.md`. Não implementa
nem habilita o cálculo F1 em `app/`. Testes novos usam visitas inventadas a um pomar
e cronologia injetada. Nenhum banco real é acessado.

## 1. Opt-in e interface do provider

`DatasetDescriptor.protocolVersion` continua `1`. Novas capacidades:

```ts
queryVersions: [1, 2, 3],
maxDimensions: 4, // ou maior, até 10
runningSum: true,
runningSumProfiles: RunningSumProfile[],
```

Tipo exportado em `packages/sandbox-contracts/src/index.ts`:

```ts
interface RunningSumProfile {
  version: 1;
  id: string;
  label: LocalizedText;
  description: LocalizedText;
  metricId: string;
  axisFieldId: string;
  dimensions: string[];
  partitionBy: string[];
  orderDimensions: string[];
  chronology: { id: string; missing: 'reject' };
  displayFilterFields: string[];
}
```

Regras validadas:
- Dimensões disponíveis, únicas, dentro de `maxDimensions`, autorizadas em
  `metric.groupableBy`. Métrica aditiva com `sum` e `supportsRunningSum: true`.
- `partitionBy` e `orderDimensions` são não vazias, disjuntas, cuja união é
  exatamente `dimensions`. Se há `multiSelection`, seu campo pertence à partição.
- `axisFieldId` é dimensão ordenada dentro de `orderDimensions`. Os outros campos
  de ordem podem ser códigos nominais; **não se usa ordem lexical desses códigos**.
- Todos os filtros dos `displayFilterFields` são obrigatoriamente pós-cálculo,
  venham de preset, faceta ou editor avançado. Esses campos pertencem ao grão e
  são proibidos em `query.filters`, mesmo sem filtro equivalente de exibição.
- `chronology.id` identifica um algoritmo/versionamento real do provider, que a
  biblioteca não executa. `missing: 'reject'` exige `ORDER_UNAVAILABLE` se alguma
  observação participante não puder ser ordenada inequivocamente, inclusive fora
  do recorte. Não desempatar por ID/ordem de importação nem inventar horários.

Perfis/IDs de cronologia são **imutáveis semanticamente**. Mudar regra exige novo ID
ou versão semântica do dataset. O provider omite perfis não implementados e rejeita
seleções inviáveis em runtime quando há cobertura parcial; não promete dados ausentes.
Conservar `runningSumScopes` e query versions legadas já suportadas:
`runningSumProfiles` não substitui nem reinterpreta esses contratos antigos.

## 2. Exemplo para Terra — sem regra F1 no núcleo

Após implementar/testar o provider, pode anunciar:

```ts
{
  version: 1,
  id: 'driver-all-sessions-v1',
  label: { fallback: 'Pontos acumulados por piloto/temporada' },
  description: { fallback: 'Todas as sessões anteriores; rodada e sessão só recortam a exibição. Não é classificação oficial.' },
  metricId: 'points', axisFieldId: 'round',
  dimensions: ['round', 'driver', 'season', 'session'],
  partitionBy: ['driver', 'season'],
  orderDimensions: ['round', 'session'],
  chronology: { id: 'validated-local-session-calendar-v1', missing: 'reject' },
  displayFilterFields: ['round', 'session'],
}
```

`points.groupableBy` precisa permitir as quatro dimensões. Não adicionar `session`
a `requiredDimensions` da métrica antiga silenciosamente: o perfil novo fixa o grão.
Calendário real validado determina a ordem. `orderDimensions` identifica a observação,
não manda ordenar códigos de sessão nem assumir sprint antes de corrida em todos os
casos. Horário ausente/ambíguo gera erro, não fallback para rodada/ID.

Mostrar só corrida da rodada 5 inclui todas as sessões participantes anteriores do
piloto naquela temporada, inclusive sprints anteriores e a sprint da mesma rodada
se cronologicamente anterior. Não inclui sessão posterior. Mostrar só sprint também
inclui corridas anteriores, sem reiniciar por sessão. Pilotos/temporadas não se somam.
O provider define/testa cobertura esperada, duplicidades e nulos; horário disponível
não implica que o resultado esteja disponível e ausência de resultado não é zero.

Equipe/outros campos continuam população se não declarados como recorte. A UI informa
a separação. Para torná-los recorte, publicar perfil/granularidade correspondente,
sem alterar o significado de um perfil já salvo.

## 3. Query/result v3 e ordem obrigatória

```ts
{
  protocolVersion: 3,
  // requestId, datasetId/schemaVersion/semanticVersion/selection como antes
  dimensions: ['round', 'driver', 'season', 'session'],
  metrics: [{ metricId: 'points', aggregation: 'sum' }],
  filters: [{ fieldId: 'season', op: 'in', values: ['2024', '2025'] }],
  displayFilters: [
    { fieldId: 'round', op: 'range', min: 5, max: 10 },
    { fieldId: 'session', op: 'in', values: ['results'] },
  ],
  window: {
    kind: 'runningSum', metricId: 'points', scope: 'profile',
    profileId: 'driver-all-sessions-v1',
    orderBy: 'round', // eixo EXIBIDO; cronologia efetiva vem do perfil!
    partitionBy: ['driver', 'season'],
  },
  orderBy: [{ fieldId: 'round', direction: 'asc' }],
  limit: 5000,
}
```

Validar com `assertQuery(q, descriptor)`: grão, partição, eixo e métrica devem
corresponder ao perfil. `displayFilters` só aceita campos declarados. V3 não aceita
janela legada nem perfil desconhecido. Resposta repete `protocolVersion: 3`, requestId
e selectionToken, com uma linha por chave **completa** das quatro dimensões.

```text
seleção/revisões consistentes → filtros de população
→ agregar ocorrências por todas as dimensions
→ validar cronologia de TODAS as observações participantes
→ acumular na cronologia do perfil, reiniciando SOMENTE por partitionBy
→ aplicar displayFilters nas linhas já acumuladas
→ ordenar apresentação por query.orderBy → conferir limite/complete/totalRows
```

Não recortar rodada/sessão nem limitar linhas antes da janela. Ordem descendente de
apresentação não inverte o cálculo. Decimal continua exato; nulo anterior não vira
zero. `ORDER_UNAVAILABLE` não vira resultado vazio ou soma parcial. Facetas seguem v1
para escolher valores; os filtros da faceta não definem a população da janela.

## 4. UI/core e quarta dimensão

Extensões de `VisualizationSpec`, exclusivas de configuração/modelo v3:

```ts
extraDimensions?: string[];
calculation?: { version: 3; profileId: string };
```

- `visualizationDimensions(v)` = X + série + comparação + extras, até a capacidade.
- `withCalculationProfile(d, v, profileId)` é ação **explícita**, não usada ao abrir
  documento antigo. Configura eixo/métrica/grão, ativa janela, remove escopo legado/
  segunda medida e reinicia a configuração de colunas.
- `configurationQuery` e `buildQuery` compartilham roteamento e validação. Presets,
  facetas e filtros avançados do campo Sessão têm a mesma semântica pós-cálculo.
- À direita, escolher perfil fixa campos/agregação. A área de filtros informa os
  campos só de exibição e os filtros ativos da entrada. Sair do perfil é explícito:
  remove janela/extras; filtros permanecem selecionados, voltando a ser população.
- Extras sem janela permitem consultas v3 com mais de três dimensões. Para
  acumulá-las, usar perfil, não janela legada v1/v2.
- Tabela/preview/ordenação/exportação conservam a quarta dimensão. Em linha/barra
  com eixo Rodada, sessão identifica **sub-séries visuais**: não soma sessões no
  renderer, não une duas células na mesma rodada e não reinicia a partição do cálculo.
  Um eixo temporal único por observação exige outro campo/perfil do provider;
  a biblioteca não cria timestamps.

## 5. Persistência — interface exata, sem quebra do store v2

`SavedModelDocumentV3` tem `documentVersion: 3`, restante do envelope latest igual
ao v2. `ModelDocument = SavedModelDocument | SavedModelDocumentV3`.

```ts
interface SavedModelStoreV3 {
  documentVersion: 3;
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: ModelDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<ModelDocument>;
  delete(request: { id: string; expectedRevision: string },
         signal?: AbortSignal): Promise<void>;
}
// Nova propriedade opcional: AnalysisStore.modelsV3?: SavedModelStoreV3
```

O store v3 lê **v2 e v3** na mesma coleção, preservando versão/conteúdo e CAS. A UI
prefere `modelsV3`. O backend deve validar/reter os campos novos; não basta anunciar
marker 3 num wrapper cujo validador Rust ainda descarta campos. O caminho antigo
`models` permanece exclusivo de v2, sem listar/sobrescrever documentos v3 por cliente
antigo. Não duplicar registros nem migrar ao abrir. Atualizar v2 para v3 só por ação
explícita (escolher perfil e salvar), com a revisão anterior.

Usar `makeModelV3`, `parseModelDocumentV3` ou `parseSavedModelDocument` (aceita 2/3).
`parseModelDocument` continua exclusivo de v2 e rejeita v3; também rejeita campos v3
disfarçados sob versão 2. `PROFILE_MODEL_DOCUMENT_VERSION` é 3; constantes antigas
`PROTOCOL_VERSION`, `DOCUMENT_VERSION` e `MODEL_DOCUMENT_VERSION` não mudam.

Sem `modelsV3`, consultar/explorar perfil continua possível se o provider permitir,
mas salvar fica indisponível com aviso. Sem fallback para v2, pinned ou localStorage.
Latest, limites e CAS mantêm as garantias v2. O store de exemplo v3 é volátil e aceita
ambos os documentos; a adaptação/persistência da coleção real é tarefa do host.

## 6. Compatibilidade, testes e aviso à integração

- V1 mantém filtros antes da soma e partição por todas as outras dimensões.
- V2 mantém somente eixo pós-cálculo: Sessão ainda é população. Modelos v2 não
  recebem perfil/quarta dimensão nem mudam de resultado ao abrir sob provider v3.
- V3 só mediante opt-in e novo documento/configuração, sem upgrade implícito.
- `tests/studio.test.mjs` agora usa multisseleção de temporadas por checkboxes;
  `?selected` do preview sintético também foi adaptado ao controle atual.
- `tests/v3.test.mjs`: recorte múltiplo, agregação pré-janela, cronologia não lexical,
  partições, descendente, nulos, ordem ausente fora do recorte/empate, versões,
  permissões, grão extra e CAS/persistência.
- `tests/v3-ui.test.mjs`: perfil, quarta dimensão, filtros de entrada/exibição,
  valores acumulados, bloqueio de store v2 e salvar/abrir latest v3.

**Terra ainda deve implementar** perfil/cronologia/cobertura F1, store nativo v3,
testes de backend/IPC e habilitação das capacidades reais. Esta entrega não altera
`app/`, SQLite, dados pessoais ou modelos padrão, nem afirma que o acumulado já está
ativo na aplicação. Tauri/WebKitGTK, leitor de tela, histórico/calendário real e
desempenho nativo permanecem fora da validação sintética da biblioteca.
