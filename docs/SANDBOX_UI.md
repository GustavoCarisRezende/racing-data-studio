# Sandbox: revisão visual e funcional — 08/11/2026

Referência: `temp/exemplo_sandbox_dados.png`. A revisão reproduz a hierarquia do
estúdio, não controles ilustrativos sem implementação.

## Organização e seleção

- Três painéis 20/60/20 em containers ≥900px; dois entre 750 e 899px; empilhados
  abaixo disso. O host amplia apenas a área da sandbox. Não há rolagem horizontal
  de página necessária; tabelas podem ter sua própria rolagem.
- Esquerda: seleção principal (temporada na F1), visões do dataset e filtros
  pesquisáveis com checkboxes e resumo. O editor genérico fica em **Filtros
  avançados**, não é o caminho obrigatório para selecionar pilotos.
- Centro: Linha/Barra/Tabela, ações realmente fornecidas pelo host,
  eixo/métrica/agrupamento, gráfico e pré-visualização recolhível/paginada.
- Direita: campos, agregação, comparação e informações da métrica/capacidades.
  Os seletores repetidos editam o **mesmo estado**, sem defaults concorrentes.
- A F1 inicia na temporada mais recente com resultados locais, eixo Rodada,
  agrupamento Piloto e gráfico de linhas. Não seleciona favoritos fictícios.
- Comparar temporadas inclui uma segunda temporada no filtro, preservando a
  identidade temporada/entidade de cada série. Não importa ou atualiza snapshots.
- Limpar filtros preserva a seleção principal e o escopo da visão ativa.
  Remover um filtro individual elimina apenas a restrição daquele campo.
- Facetas mostram nomes da fonte, não IDs quando há nomes disponíveis. Filtros
  continuam usando IDs. Nomes ausentes mantêm fallback; nomes iguais em identidades
  diferentes são desambiguados. Não há inferência de continuidade histórica.
- Corrida, sprint e equipe são presets do mesmo dataset com consultas reais.
  Sprint só aparece se há resultados sprint em algum recorte local; uma temporada
  sem sprint pode retornar vazio, que é informado sem fabricar pontos.
- Agregação única aparece como valor informativo, não dropdown desabilitado sem
  explicação. Acumulados, média móvel, pizza, dispersão, calendário analítico e
  exportação nativa F1 não foram habilitados; não há controles que os prometam.

## Metadados opcionais

São adições ao descriptor v1, não ao documento salvo. `assertDataset` valida
referências, tipos, limites e configurações. Exemplo agnóstico de categoria:

```ts
presentation: {
  primaryFilterFieldId: 'campaign',
  filters: [{ fieldId: 'plot', label: { fallback: 'Plots' } }],
  defaultVisualization: {
    kind: 'line', x: 'week', metric: { metricId: 'harvest', aggregation: 'sum' },
    series: 'plot', comparison: 'campaign', runningSum: false,
  },
  defaultFilters: [{ fieldId: 'campaign', op: 'in', values: ['2025'] }],
  views: [{
    id: 'harvest-by-plot', label: { fallback: 'Harvest by plot' }, filters: [],
    visualization: {
      kind: 'line', x: 'week', metric: { metricId: 'harvest', aggregation: 'sum' },
      series: 'plot', comparison: 'campaign', runningSum: false,
    },
  }],
}
```

Defaults se aplicam a uma nova visualização. Abrir análise salva usa o documento,
sem substituir filtros/visualização por defaults. Sem hints, a UI deriva filtros
rápidos de dimensões que suportam `in`. Sem `facet`, não oferece esses controles.
Presets não mudam datasetId nem adicionam propriedades ao JSON enviado ao store.

Para códigos fixos, `FieldDescriptor.valueLabels` traduz o rótulo, não o valor:

```ts
valueLabels: [{ value: 'results', label: {
  fallback: 'Race', translations: { 'pt-BR': 'Corrida' },
} }]
```

Para entidades, `labelField` identifica a coluna de nome. O provider retorna essa
coluna quando a chave é agrupada. A tabela mostra o nome na célula da entidade,
sem uma segunda coluna redundante. A busca na faceta deve considerar nome e ID,
mas `FacetPage.value` precisa conservar a chave original. Exportação genérica
preserva as colunas e valores completos do contrato.

## Verificação visual sem banco

```sh
cd packages
npm test
node scripts/visual-smoke.mjs
```

O preview abre somente `http://127.0.0.1:4179` com bundle sintético em
`examples/dist/`, ignorado no Git. Fecha automaticamente em dez minutos;
interromper com Ctrl+C ao concluir. Não importa Tauri nem acessa SQLite/Jolpica.

`examples/visual-smoke.tsx` usa o **adapter F1 real** com reader injetado e pessoas,
equipes e resultados inventados de `examples/synthetic-f1.mjs`. O store é volátil.
A página identifica os dados como sintéticos e não faz parte do build do app.

CSP do preview: scripts/estilos/imagens locais, sem `unsafe-eval`/`unsafe-inline`.
Uma imagem invisível aguarda SVG/tabela reais para capturas headless, sem um atraso
arbitrário. Esse mecanismo existe somente no harness visual.

`http://127.0.0.1:4179/?selected` exercita os controles no próprio DOM: abre Pilotos,
seleciona Ana Lima e Bruno Reis e ativa a comparação de 2025/2024 antes de liberar
a captura. Não altera defaults do app nem lê seleções de um banco real.

Testes automatizados cobrem temporada, nomes, pilotos/equipes/rodadas/sessões,
presets, comparação, sincronização de campos, linha/barra, preview e salvar/abrir.
Também verificam que Race + Sprint é agregado uma vez por rodada/entidade, não
tratado como duas linhas de pontos por evento sem identificação.

## Limites reais

- Só resultados já importados; não há classificação oficial, novos importadores,
  telemetria, tempos de volta ou normalização de pontuação histórica.
- Agregação F1 segue em memória no adapter TypeScript, com os limites já existentes.
  Desempenho com grandes históricos ainda exige medição/otimização no desktop.
- A UI pode editar configurações em memória; não há autosave ou confirmação ao
  trocar dataset. O store real continua responsável por durabilidade e conflitos.
- A comparação principal oferece duas seleções; documentos antigos/avançados com
  mais valores mantêm os filtros e os valores adicionais são informados.
- Seleções continuam fixadas em revisões. Atualizações de dados exigem ação do host.
- Browser com dados sintéticos não valida IPC, permissões ou CSP do Tauri/WebKitGTK,
  nem substitui testes com leitor de tela e plataformas adicionais.
- Nenhum teste desta revisão abre o banco pessoal ou executa sincronização.
- Para preservar análises antigas, filtros avançados F1 de texto ainda consultam
  IDs/códigos literais; o formulário informa isso. Busca por nome deve usar as
  seleções pesquisáveis de Pilotos/Equipes, que retornam IDs corretamente.
