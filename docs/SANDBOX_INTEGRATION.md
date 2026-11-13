# Contrato de integração da sandbox — protocolo/documento v1

> Extensões atuais (queries v2, modelos latest, pizza/dispersão, tabela e handoff
> para Terra): [SANDBOX_V2_HANDOFF.md](SANDBOX_V2_HANDOFF.md). Este documento mantém
> o contrato legado; análises fixas v1 não são convertidas em modelos.

> Acumulado entre sessões com filtros múltiplos pós-cálculo: contrato opt-in
> [SANDBOX_V3_ACCUMULATION.md](SANDBOX_V3_ACCUMULATION.md). Não muda a semântica v2.

Biblioteca independente em [`packages/`](../packages/README.md), integrada pela
camada `app/src/categories/f1/analysis-*`. A revisão visual de 08/11/2026 ajustou
também a composição React e o adapter F1, sem modificar SQLite, migrations,
sincronização ou permissões. Testes visuais usam snapshots inventados, não o banco
do usuário. Consulte [SANDBOX_UI.md](SANDBOX_UI.md) para a organização dos painéis,
metadados opcionais de apresentação e reprodução dos testes visuais.

## 1. Responsabilidades e entry points

```text
Aplicação/categoria → adapter provider/store/host → Sandbox React
                                  ↓                 ↓
                          backend da categoria    ChartModel próprio
                                                    ↓
                                               adapter ECharts
```

- Contratos: `packages/sandbox-contracts/src/index.ts`.
- Validação runtime: `packages/sandbox-contracts/src/validation.ts`.
- Núcleo: `packages/sandbox-core/src/index.ts`.
- UI: `packages/sandbox-react/src/index.tsx`; CSS deve ser importado explicitamente.
- Renderer: `packages/sandbox-echarts/src/index.tsx`.
- Provider/store de referência: `packages/examples/memory-provider.mjs`.
- Fixtures neutras: `packages/fixtures/*.json`.

Nenhum pacote conhece os nomes dos comandos nativos, caminhos de banco, tabelas,
entidades esportivas ou a estrutura JSON Jolpica. Não copiar esse conhecimento para
o núcleo compartilhado.

## 2. Preparar os pacotes para consumo

1. Em `packages/`, executar `npm ci --ignore-scripts` e `npm test`.
2. Os exports apontam para `dist/`; compilar antes do build da aplicação.
3. Registrar **todos os pacotes locais usados** no mecanismo de workspace/local
   dependencies escolhido pela integração. Não publicar nem tentar obter `@rds/*`
   no registry público; são pacotes privados locais na versão 0.1.0.
4. Instalar apenas um pacote local isoladamente não resolve automaticamente os
   outros pacotes privados. O integrador deve revisar a resolução transitiva e o
   lockfile da aplicação quando fizer essa alteração.
   Uma alternativa controlada para Vite é resolver os quatro nomes `@rds/*` para
   os respectivos `packages/sandbox-*/dist/index.js` e resolver
   `@rds/sandbox-react/style.css` para `packages/sandbox-react/src/style.css`.
   Nesse caso, `npm ci` em `packages/` continua sendo pré-requisito do build,
   ECharts é resolvido no workspace dos pacotes e a aplicação deve usar
   `resolve.dedupe: ['react', 'react-dom']`. Revisar também o escopo de acesso a
   arquivos no dev server; não liberar o sistema de arquivos inteiro. Esta
   alternativa exige validação no build real do host, ainda não executada aqui.
5. Se forem usados links/aliases a partir de outro workspace, deduplicar
   `react`, `react-dom` e `react/jsx-runtime` para a cópia da aplicação. Os peers
   aceitam React 19; não carregar o React de desenvolvimento de `packages/` como
   uma segunda instância no bundle do host.
6. Não incluir jsdom, TypeScript ou esbuild no runtime desktop.

Exemplo de composição (o integrador define como resolver os imports locais):

```tsx
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import type { SelectionRequest } from '@rds/sandbox-contracts';
import '@rds/sandbox-react/style.css';

// Criar fora do render ou com useMemo. Não recriar provider/store/selection a cada render.
const selection: Omit<SelectionRequest, 'protocolVersion' | 'datasetId'> = {
  policy: 'latest', partitionIds: ['2024', '2025'],
};

function AnalysisScreen() {
  return <Sandbox provider={provider} store={store} host={host}
    selection={selection}
    ChartRenderer={EChartsRenderer} locale="pt-BR" />;
}
```

Recomendação: lazy-load da tela e do renderer na entrada da sandbox. A biblioteca
não cria servidor; o renderer recebe dados já calculados. Sem renderer, a UI só
oferece tabela. Sem store/exportFiles, os respectivos controles não aparecem.

## 3. Provider e descrição de dados

Interface implementada pelo adapter da categoria:

```ts
interface SandboxDataProvider {
  listDatasets(signal?: AbortSignal): Promise<DatasetSummary[]>;
  describeDataset(request: { datasetId: string; locale: string }, signal?: AbortSignal): Promise<DatasetDescriptor>;
  resolveSelection(request: SelectionRequest, signal?: AbortSignal): Promise<ResolvedSelection>;
  query(request: QueryRequest, signal?: AbortSignal): Promise<QueryResult>;
  facet?(request: FacetRequest, signal?: AbortSignal): Promise<FacetPage>;
}
```

`listDatasets` retorna apenas dados locais utilizáveis; não listar mocks ou fontes
remotas como disponíveis. Catálogo limitado a 200 datasets nesta UI. IDs e versões
são estáveis e nunca traduzidos. Rótulos usam `{ fallback, translations? }`.

`describeDataset` deve fornecer traduções necessárias no mesmo descriptor. Trocar
idioma na UI reformata o resultado existente sem reconsultar ou perder filtros.
`locale` é sugestão inicial para o adapter, não chave de identidade do dataset.

Cada campo declara tipo físico, papel dimensão/medida, tipo analítico, nulabilidade,
ordem, operadores e disponibilidade. **Campo numérico não implica medida somável.**

| Tipo físico | Valor JSON |
|---|---|
| `integer` | número inteiro seguro, sem NaN/Infinity |
| `decimal` | string decimal canônica, ex. `"12.50"`; sem expoentes/comma |
| `date` | `YYYY-MM-DD`, sem conversão de fuso |
| `datetime` | instante ISO com segundos, timezone explícito e até três casas de milissegundos |
| `string` / `boolean` | valor correspondente |
| nulo | `null`, nunca string vazia ou zero para representar ausência |

IDs numéricos grandes, como IDs SQLite, devem ser strings, não `integer` inseguro.
Não usar `__proto__`, `constructor` ou `prototype` como ID. IDs técnicos seguem
`[A-Za-z0-9][A-Za-z0-9_.:-]*`, até 128 caracteres.

Métricas têm ID de saída **diferente** do ID de campo bruto. Exemplo:
`harvest_kg` é campo; `harvest` é métrica. Isso evita ambiguidade entre dado bruto
e agregado. Metadados incluem definição, agregações permitidas, agrupamentos,
política de nulos, aditividade e suporte a acumulado.

`requiredDimensions`, quando usado em uma métrica, impede eliminar dimensões
semânticas obrigatórias. Por exemplo, uma categoria pode exigir a dimensão da
temporada para nunca somar temporadas silenciosamente. O editor preserva esse
agrupamento e o backend também deve verificá-lo. Isso não é uma regra F1 embutida.

Não misturar agregações com unidades diferentes na mesma métrica (por exemplo
quilos e quantidade de medições): publicar métricas separadas com definições e
unidades corretas. `groupableBy` é allowlist, não sugestão.

`labelField` é opcional: o ID agrupado continua na coluna original, e o provider
pode retornar uma coluna textual auxiliar com o rótulo. Ela deve estar descrita
nos campos. Gráficos mantêm ID junto ao rótulo para evitar colisões entre nomes.

Capacidades representam funcionalidades reais. `comparisonDimensions` identifica
dimensões que podem ser adicionadas à identidade da série; a biblioteca não
deduz equivalência histórica entre elas.

## 4. Revisões e consistência

`resolveSelection` recebe `latest` ou `pinned`, partições opacas e, no segundo caso,
as referências completas. Retorna:

```ts
{
  protocolVersion: 1,
  datasetId: 'dataset.id',
  token: 'opaque-token',
  transformationVersion: 'provider-transform-1',
  revisions: [{
    partitionId: '2024', revisionId: '123',
    sourceDataAt: '2026-01-01T00:00:00Z',
    storedAt: '2026-01-02T00:00:00Z',
  }],
}
```

Requisitos:

- Resolver todas as partições em leitura consistente; máximo 2000 referências.
- Token deve identificar **exatamente** os dados e transformação resolvidos.
- Queries/facetas seguintes nunca trocam para latest por conta própria.
- Token expirado pode ser reconstruído para as mesmas revisões; não deve permitir
  seleção arbitrária ou burlar validação. Não serializar conexão/caminho no token.
- Ausência de revisão ou transformação compatível gera `REVISION_MISSING`/erro
  explícito, nunca fallback silencioso.
- `storedAt` e `sourceDataAt` têm significados distintos; cópia/restauração não torna
  o conteúdo mais recente. `sourceDataAt` pode ser nulo se desconhecido.

Ao reabrir, a UI chama `resolveSelection(pinned)` e confere referências e versão de
transformação. Token pode mudar, mas os dados não. Nenhum dado novo é baixado.
Uma seleção inicial `latest` também fica congelada após resolver. Para atualizar
deliberadamente a tela, o host pode trocar a identidade de `selection` ou remontar
a sandbox; essa ação não é automática nem há botão fictício implementado.

## 5. Query v1: semântica executável

Ver fixtures `query.request.json` / `query.result.json`. Ambos são comparados com
o provider de referência em teste; o backend Rust pode consumir os mesmos arquivos.

Ordem obrigatória:

```text
validar versões/capacidades/seleção
→ selecionar ocorrências nas revisões
→ filtros de população (AND; OR dentro de in)
→ agregar por todas as dimensions
→ aplicar window, se solicitada
→ ordenar conforme orderBy
→ conferir limite e retornar resultado completo
```

- `dimensions` contém IDs únicos de campos de dimensão disponíveis.
- `metrics` contém pares de metricId e aggregation autorizados.
- Cada dimensão precisa pertencer ao `groupableBy` de cada métrica.
- Retornar exatamente uma linha por chave de agrupamento. IDs de ocorrência
  repetidos da fonte devem ser preservados **antes** da agregação, não deduplicados
  pela UI ou por um pressuposto de unicidade esportiva.
- `orderBy` usa valores tipados; inteiros não podem ser ordenados como strings.
- Decimais devem ser calculados sem arredondamento intermediário em `f64/Number`.
- Strings de filtro `contains` são literais, não SQL LIKE ou regex sem escaping.
  Documentar política de caixa/acentos do provider; o exemplo usa case-insensitive.
- Há um filtro por campo; substituir um filtro existente é explícito no editor.
- Intervalos são inclusivos. Datas canônicas são comparáveis; instantes devem ser
  comparados cronologicamente, não lexicalmente com timezones diferentes.
- `isNull/isNotNull` não significam zero/não zero.

Window v1 só admite `runningSum` com agregação `sum`, medida aditiva e eixo ordenado.
`partitionBy` deve conter **todas** as dimensões restantes. `scope` é sempre
`filteredSelection`: NÃO afirmar que o total considera linhas excluídas pelos
filtros ou regras oficiais externas ao dataset.

Ausências e lacunas são domínio do provider. `nullPolicy=ignore` deve retornar nulo
quando não houver observação válida; não fabricar zero. `propagate` faz a ausência
participante tornar o agregado desconhecido. O provider decide, documenta e testa
quais ocorrências eram esperadas. Para um acumulado desconhecido após evento ausente,
deve retornar os nulos adequados nos eventos seguintes; a UI não o recompõe.

### Resultado

- `protocolVersion`, `requestId` e `selectionToken` correspondem à consulta.
- Colunas podem ser dimensões solicitadas, seus labelFields e métricas solicitadas.
- Cada linha contém todas as colunas, sem propriedades extras; `row.id` é estável
  dentro do mesmo resultado/revisão e não depende do idioma.
- Tipos das métricas: count/countDistinct → integer; mean → decimal;
  sum/min/max → tipo numérico do campo de origem.
- `complete=true` significa todo o resultado filtrado/agrupado, não a primeira página.
  Se `totalRows` não for nulo, precisa corresponder à quantidade retornada.
- Sem cursor de resultados em v1: exceder `limit` deve gerar `LIMIT_EXCEEDED`.
  `complete=false` é explicitamente parcial e só habilita inspeção tabular.
- Limites runtime: 100 mil linhas máximas declaradas; 500 mil células verificadas;
  20 mil células para gráficos; até 100 séries ou limite menor do dataset.
- A tabela React mostra páginas locais de 50 linhas. NÃO agregar/exportar apenas
  essa página; exportação usa o resultado completo.
- Emitir warnings estruturados e limitações traduzíveis, sem alegar completude
  histórica absoluta quando só se conhece a cobertura importada.

## 6. Facetas

Só implementar `facet` se houver suporte real. Request inclui seleção fixa, fieldId,
filtros **sem o filtro do próprio campo**, busca literal, cursor e limite.
Valores retornados mantêm seu tipo físico; rótulos e contagens são auxiliares.
Busca/paginação devem ser estáveis na seleção; `nextCursor` deve progredir.

A UI solicita 100 por página, limita exibição a 1000 e seleção a 200. Consultas
substituídas recebem abort; a UI também ignora respostas atrasadas. Cancelamento
nativo efetivo, cache e trabalho fora da thread UI são responsabilidade do adapter.

## 7. Store injetado e documentos salvos

```ts
interface AnalysisStore {
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: AnalysisDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<AnalysisDocument>;
}
```

Documento v1 contém identidade, revisão, título, versões do dataset, seleção
resolvida, configuração própria de visualização, filtros e datas. Não contém
opções ECharts, funções, HTML ou SQL. Use `parseAnalysisDocument` no adapter e
repita validação no Rust. O retorno de `load` é unknown intencionalmente.

`save` deve ser transacional e aplicar compare-and-swap:

1. Documento novo: `revision=null` e `expectedRevision=null`.
2. Se já existe com revisão diferente, retornar `CONFLICT`; nunca sobrescrever.
3. Criar nova revisão opaca, preservar histórico conforme política da categoria.
4. Retornar o documento salvo com revisão não nula. Não mudar título, filtros,
   seleção ou visualização durante o salvamento.

A UI valida o retorno e só marca como salvo se o usuário ainda estiver no mesmo
estado de edição. `list` admite até 1000 entradas; paginação será evolução futura.
O exemplo em memória não persiste entre processos e não prova a durabilidade do
store nativo. Salvar dados reais deve ficar no banco da categoria, não num SQLite
central criado pela biblioteca.

Versões são independentes: protocolo, documento, schema, semântica, transformação
e revisões dos dados. Documentos são limitados a 256000 unidades UTF-16 após
serialização; o backend pode adotar um limite de bytes adicional, sem truncamento.
Não migrar documentos incompatíveis silenciosamente. A
implementação atual aceita v1 e rejeita versões futuras; migradores precisam ser
adicionados explicitamente e preservar o documento original.

## 8. Exportação pelo host

```ts
interface SandboxHostServices {
  exportFiles?: (files: ExportArtifact[], signal?: AbortSignal) => Promise<void>;
}
// ExportArtifact: { name, mediaType, text }
```

O host recebe CSV e manifesto juntos; escolhe destino, pede confirmação e grava.
Os nomes gerados usam ID técnico validado, não caminhos recebidos da fonte. Não
conceder filesystem genérico à UI. O host deve tratar sobrescrita, falha parcial,
atomicidade e cancelamento; sucesso da Promise significa que concluiu seu contrato.

CSV usa valores canônicos, com proteção básica contra fórmulas em células textuais.
Nulos e strings vazias não são distinguíveis; manifesto registra esse limite.
Manifesto inclui seleção, consulta, métricas, unidade, licenças, atribuição e warnings.
Não remover a atribuição dos dados reais. Não há botão PNG/SVG/PDF/XLSX.

## 9. Mapeamento sugerido para Terra (não implementado aqui)

| Método | Comando da categoria sugerido |
|---|---|
| listDatasets | `f1_analysis_catalog` |
| describeDataset | `f1_analysis_describe` |
| resolveSelection | `f1_analysis_resolve` |
| query | `f1_analysis_query` |
| facet | `f1_analysis_facet` |
| store.list/load/save | `f1_saved_analyses_list` / `f1_saved_analysis_load` / `f1_saved_analysis_save` |

Esse mapeamento pertence ao adapter da categoria, não aos pacotes. Preferir uma
projeção tipada dos snapshots existentes, leitura consistente e agregação Rust.
Não reutilizar os fragmentos brutos de `f1_season_details` como contrato genérico.
Cache pode usar revisões + versão de transformação. Não alterar importação nem
restauração como efeito colateral de uma query.

Para a primeira integração F1:

- Definir granularidade que preserve múltiplas ocorrências históricas.
- Preservar pontos da fonte, posição especial, status e equipe no resultado.
- Exigir dimensão da temporada quando necessário (`requiredDimensions`) e sempre
  particionar acumulados por temporada/série.
- Race/Sprint/Race+Sprint são escopos sem dupla contagem; sessão de calendário
  não implica disponibilidade de resultados.
- Não chamar soma de pontos de resultados de classificação oficial do campeonato.
  Descartes, penalidades e regras históricas de construtores exigem semântica própria.
- Não conectar equipes por continuidade presumida, nem normalizar épocas sem dados.
- Rodada alinha calendários, não identifica o mesmo circuito em anos diferentes.
- Fonte, licença Jolpica e data de origem precisam acompanhar dados e exportação.

## 10. Aceite da integração

1. Usar fixtures JSON neutras para equivalência TS/Rust, incluindo rejeições.
2. Build da aplicação com uma única instância React e lockfiles revisados.
3. Testar catálogo vazio, dados parciais, erros, duas temporadas, filtros e nulos.
4. Confirmar consulta/CSV completos, sem amostra disfarçada.
5. Salvar, reiniciar offline, abrir a mesma revisão e detectar conflito de edição.
6. Atualizar/restaurar temporada e confirmar que análises fixadas não mudam.
7. Validar capabilities/CSP e rede no Tauri compilado; sem exceções amplas.
8. Testar teclado/leitor de tela, 360px, janela 1024px, três painéis e zoom 200%.
9. Medir consulta, IPC, RAM e renderização no WebKitGTK e validar plataformas extras.
10. Incluir licenças/NOTICE e SBOM do produto; não distribuir bancos preenchidos.

Pendências e limites explícitos constam em `packages/README.md`. Nenhum teste deste
workspace acessa dados pessoais ou substitui os testes desktop/backend da categoria.
