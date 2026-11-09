# Sandbox independente — v0.1.0

Biblioteca própria do Racing Data Studio, sem imports da aplicação, F1, Tauri,
SQLite ou fontes de dados. O host F1 em `app/` faz a integração; os pacotes não
acessam banco/importador. Testes usam somente fixtures. Licença do código e das fixtures:
[Apache-2.0](../LICENSE).

## Pacotes

| Pacote | Responsabilidade |
|---|---|
| `@rds/sandbox-contracts` | Protocolo JSON v1, metadados, queries, provider/store/host e validação runtime |
| `@rds/sandbox-core` | Defaults, configuração, queries, modelo gráfico, valores exatos e CSV + manifesto |
| `@rds/sandbox-react` | Editor responsivo, filtros, tabela, salvar/abrir por store injetado e i18n |
| `@rds/sandbox-echarts` | Adapter SVG modular ECharts 6.1.0; linhas e barras |

Os pacotes são privados e ESM, com exports de `dist/`; não são publicados no npm.
`sandbox-react` não depende do adapter ECharts. React é peer dependency: a aplicação
deve resolver **uma única instância** de React/React DOM. O workspace tem lockfile
próprio, sem alterar `app/package.json` ou seu lockfile.

## Instalar e verificar

Execute **dentro de `packages/`**, nunca na raiz ou em `app/` para estes testes:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm test
npm run size
npm audit
npm audit signatures
npm run notices
```

Node suportado pelo workspace de testes: `^22.22.2 || ^24.15.0 || >=26.0.0`
(o requisito mais alto vem do jsdom de desenvolvimento). Validado com Node
24.18.0. Não é necessário executar TypeScript diretamente no Node: `tsc -b`
emite JS ESM, e o runner nativo executa `tests/*.test.mjs`. Não há servidor,
download de navegador, script de instalação autorizado ou dependência do Node
da aplicação. Build incremental e `node_modules` são ignorados no Git.

O esbuild usado somente na medição utiliza o binário da dependência opcional
da plataforma. Se a plataforma não tiver esse pacote, **não habilite todos os
scripts de instalação**: revise a distribuição oficial e instale o binário
compatível de forma explícita. Essa ferramenta não faz parte do runtime.

## Composição

```tsx
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import '@rds/sandbox-react/style.css';

// Instâncias estáveis (useMemo ou módulo), implementadas pelo host.
<Sandbox
  provider={provider}
  store={analysisStore}           // opcional: sem store, não há botões de salvar/abrir
  host={hostServices}             // opcional: sem exportFiles, não há exportação
  ChartRenderer={EChartsRenderer} // opcional: sem renderer, editor só oferece tabela
  locale="pt-BR"
  selection={selectionRequest}    // opcional: padrão latest, escopo local do provider
/>
```

Para exemplo executável sem I/O, use `examples/memory-provider.mjs` com
`fixtures/orchard.dataset.json` e `fixtures/orchard.rows.json`. É um adapter
**específico de fixture**, não uma engine genérica para produção. Seu store é
volátil: persistência entre reinícios é responsabilidade do store real.

Guia de integração completo: [docs/SANDBOX_INTEGRATION.md](../docs/SANDBOX_INTEGRATION.md).
Revisão de dependências e CSP: [SECURITY.md](SECURITY.md).

## Funcionalidades efetivas

- Catálogo e metadados por provider; dimensões e métricas não são inferidas do nome.
- Queries agrupadas tipadas, versões verificadas, IDs separados de rótulos.
- Filtros AND, com múltiplos valores OR, intervalo inclusivo, texto literal e nulos.
- Facetas opcionais com busca, paginação e contagem; sem facet, não há editor `in`.
- Tabela paginada em memória, 50 linhas por página; resultado completo separado da
  apresentação. Exportação inclui todas as linhas, nunca só a página.
- Linhas e barras apenas quando permitidas pelos dados e quando há renderer.
- Comparação como dimensão adicional; a série inclui todas as identidades agrupadas.
- Acumulado **do conjunto filtrado**, calculado pelo provider e particionado por
  todas as séries/comparações. Não promete acumulado oficial ou da temporada inteira.
- Análises fixadas em revisões; restauração resolve `pinned` e verifica as revisões
  e versão de transformação. Sem atualização silenciosa para os dados mais recentes.
- Salvar/abrir pelo store, com revisão otimista e rejeição de documentos futuros.
- CSV UTF-8 + manifesto de consulta, métricas, licença, limitações e revisões.
- PT-BR e en-US; metadata traduzível, formatação exata de decimais, datas sem desvio
  de fuso e controles nativos por teclado. Trocar idioma não limpa a análise.
- Três painéis 20/60/20 em containers ≥900px; dois em ≥750px; empilhados abaixo
  disso. O host amplia o canvas da sandbox sem alterar as demais telas.
- Seleção principal e presets reais via `presentation`, filtros diretos de
  dimensões, campos sincronizados no centro/direita e preview recolhível.
- Nomes de entidades via `labelField`; códigos traduzidos por `valueLabels`;
  identidades permanecem estáveis nos filtros e consultas.
- AbortSignals, descarte de respostas antigas, debounce de queries/facetas,
  limite de células e liberação do renderer/ResizeObserver ao desmontar.

## Limites assumidos nesta versão

- UI trabalha com **uma métrica** por visualização e até três dimensões: X, série,
  comparação. O protocolo de query aceita mais métricas para evolução independente.
- Não há query bruta de ocorrências/calendário sem métrica: o editor exige ao menos
  uma métrica e uma dimensão compatíveis. Para datasets apenas tabulares de registros,
  será necessária extensão versionada, não uma contagem fictícia.
- Não há season-to-date separado de recorte de exibição; filtros precedem o acumulado.
- Sem fórmulas, SQL, plugins executáveis, média móvel, pizza, dispersão, dashboards,
  importação de arquivos, PNG/SVG/PDF/XLSX ou autosave.
- A query v1 não tem cursor de resultados. O provider deve retornar um agregado
  completo dentro do limite ou lançar `LIMIT_EXCEEDED`. Um resultado incompleto
  pode ser inspecionado como tabela, mas não vira gráfico, análise salva ou exportação.
- Capacidade máxima declarada: 100 mil linhas; orçamento global de 500 mil células
  validadas; gráficos limitados a 20 mil células e ao `maxSeries` do dataset.
  Esses tetos não são promessa de responsividade em qualquer hardware.
- Facetas: até 100 valores por página solicitada, 1000 exibidos, 200 selecionados.
  Store list: até 1000 entradas nesta UI; listagem paginada fica para outro protocolo.
- A página inteira da query fica em memória; virtualização, Arrow, streaming,
  Workers e cache de consultas não estão implementados.
- Decimais são exatos na tabela/exportação e no transporte; gráficos usam Number
  aproximado, recusando magnitudes inseguras e underflow. Cálculos são do provider.
- Ausência de célula não é zero; renderer não conecta lacunas. O provider precisa
  modelar ausências esperadas: a UI não inventa calendários nem conhecimento histórico.
- Editor em memória: trocar dataset pode descartar edições não salvas; não há prompt
  de saída nem recuperação de rascunhos. Análises já salvas não são apagadas.
- Mudanças de schema/semântica não são migradas automaticamente: v1 rejeita versões
  incompatíveis. Nenhuma promessa de reprodutibilidade de transformações não mantidas
  pelo provider.

## Verificação e pendências

Testes incluem contratos positivos/negativos, fixtures JSON neutras para Rust,
decimais, nulos, comparação entre campanhas, acumulados, store/conflitos,
CSV, resposta obsoleta, desmontagem, i18n, ciclo React com jsdom e renderização
SVG real do ECharts em SSR. O teste de carga valida/modela/exporta 5000 linhas;
não mede renderização no WebView.

`npm run size` produz bundles em memória, sem instalar servidor ou gravar release;
mede JS minificado e gzip, com React externo. Verifica ausência de `eval/new Function`
e contribuição de gráficos não solicitados na amostra. É uma verificação limitada,
não auditoria formal de segurança nem medida do instalador final.

**Ainda necessário na integração:** build Tauri de produção com CSP real,
validação visual nos breakpoints, teclado/leitor de tela (inclusive Orca), zoom 200%,
alto contraste, desempenho/RAM no WebKitGTK e demais plataformas, backend persistente,
cancelamento nativo e revisão jurídica das licenças dos dados reais. jsdom não verifica
layout, contraste nem aplicação de CSP.
