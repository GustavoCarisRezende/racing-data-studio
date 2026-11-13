# Sandbox — correção funcional/visual de 12/11/2026

Referência: `temp/exemplo_sandbox_dados.png`. Esta revisão corrige a biblioteca e
dois pontos indispensáveis do host F1, sem alterar SQL, migrations, dados ou modelos
persistidos. Alterações anteriores da integração foram preservadas. Sem commit/push.

## Modelos em um único gerenciamento

- Modelos padrão persistidos e modelos do usuário vêm da **mesma** chamada
  `modelsV3.list` (ou `models.list` no host v2), no grupo **Modelos salvos**.
  Não há registros fictícios de fallback no componente.
- Abrir, excluir com confirmação/CAS, renomear pelo título e salvar cópia estão
  integrados. Salvar fica na barra superior. Análises fixas antigas continuam
  disponíveis separadamente dentro do mesmo grupo, sem conversão automática.
- Visões do dataset ficam em **Visões do conjunto de dados**, dentro do gerenciador,
  identificadas como configurações iniciais, não registros persistidos falsos.
- **Gerenciar modelos → Restaurar padrões ausentes** só aparece com capacidade real
  do host. Depois da conclusão, a lista é atualizada automaticamente. Não exige
  apertar outro botão, não troca a visualização em edição e não limpa seu rascunho.

Nova capacidade opcional de `SandboxHostServices`:

```ts
restoreDefaultModels?: (signal?: AbortSignal) => Promise<void>;
```

O host garante restauração somente dos IDs ausentes, preservando modelos existentes,
inclusive padrões editados pelo usuário. O client não recria defaults ao montar,
abrir, atualizar lista ou excluir. Erros ficam visíveis; não há simulação de sucesso.

## Causas dos avisos indevidos e proteção de dados

O seletor de visões antes mantinha a baseline anterior **e** o vínculo com o modelo
aberto. Assim, uma visão recém-selecionada já aparecia como editada e podia apontar
o próximo salvamento ao registro anterior. Agora cada visão aberta explicitamente
começa limpa e desvinculada, sem escrever/apagar o registro anterior.

O estado sujo antes comparava `JSON.stringify` diretamente. `editableKey` compara
conteúdo canônico: ordem de propriedades, ordem dos filtros AND e ordem/repetição
de valores OR não geram edição. IDs são comparados pelo valor wire, não por collation
local. Ordem de colunas, títulos, escopos e `extraDimensions: []` continuam sendo
diferenças reais quando alteram configuração/protocolo; não há normalização que
apague semântica versionada. Salvar título aparado sincroniza a baseline e o input.

Abrir outro modelo intacto, trocar idioma, atualizar a lista, expandir controles ou
renomear apenas focando o título não pede para descartar/salvar. Uma alteração real
continua pedindo confirmação ao abrir outra configuração; Cancelar preserva a edição.
Se o usuário retorna exatamente à configuração original, ela volta a ficar limpa.
Conflitos continuam explícitos, sem sobrescrita automática.

## Gráficos no topo e diagnóstico da pizza

- Linha, Barra, Tabela, Pizza e Dispersão têm botões com ícones, nomes e
  `aria-pressed`, somente para capacidades reais. O seletor de tipo à direita foi
  removido. Não há exportação fictícia quando o host não fornece exportador.
- PieChart já estava registrado no ECharts. O problema comum era trocar a partir
  de Linha mantendo rodada × piloto × temporada: centenas de fatias eram recusadas
  e o erro aparecia apenas como “configuração incompatível”.
- Ao **pressionar Pizza explicitamente**, `forPie` escolhe categoria nominal
  compatível (priorizando o agrupamento atual), preserva comparações/agrupamentos
  obrigatórios e filtros e desliga acumulado/segunda medida. O agrupamento é exibido
  à direita e a mudança é informada. Não soma acumulados já calculados no renderer.
- Abrir um documento existente **não** chama essa transformação. Modelos antigos
  conservam grão, filtros e semântica, inclusive defaults nativos por equipe.
- Caso uma seleção ainda exceda `maxSeries`/100 fatias (por exemplo muitas temporadas),
  a UI pede explicitamente menos temporadas/categorias; não oculta anos nem amostra
  dados. Negativos/total sem valor positivo continuam recusados com aviso específico.
  A tabela conserva os valores exatos. Isso não foi “corrigido” usando valor absoluto.
- Voltar a Linha a partir de uma categoria escolhe eixo ordenado compatível, usando
  o default real do descriptor quando possível. Só uma ação explícita altera o grão.

## “Pontos após o evento”, sem abstração de perfil na UI

O contrato v3 continua exatamente o mesmo. O usuário escolhe uma **métrica**; o
seletor técnico “Perfil de cálculo” não existe mais na tela.

`RunningSumProfile` aceita metadado opcional de apresentação:

```ts
measureLabel?: LocalizedText;
// F1: { fallback: 'Points after the event',
//       translations: { 'pt-BR': 'Pontos após o evento' } }
```

A opção usa o perfil anunciado pelo provider e produz o mesmo `calculation` v3,
`metricId`, partições, cronologia e filtros pós-cálculo já existentes. Não cria
métrica persistida fictícia, não altera o algoritmo e não promove documentos v1/v2.
Rótulo intuitivo aparece no seletor, gráfico, tabela e editor de colunas. Sem o
metadado, há fallback para o rótulo real do perfil. Acumulados legados já salvos
continuam com sua semântica; não são apresentados como o cálculo novo.

## Host F1: arquivos alterados nesta rodada

- `app/src/categories/f1/analysis-screen.tsx`: injeta `restoreDefaultModels` chamando
  o comando **já existente** `f1_models_restore_defaults`; remove o botão externo e
  o aviso global que duplicavam a gestão. Restrição de filtro incompatível passa a
  ser informada contextual e genericamente pela biblioteca, usando `fieldId` do erro.
- `app/src/categories/f1/analysis-provider.ts`: somente o `measureLabel` localizado
  para `driver-all-sessions-v1`. Não foi alterado cálculo, query, revisão ou fonte.

Nenhum arquivo de `app/src-tauri/` foi modificado por esta rodada. Não há migration,
reset, limpeza de modelos ou atualização silenciosa de registros existentes.

## Layout, acessibilidade e validação

- 20/60/20 em containers ≥1100 px; duas colunas em ≥750 px, com configuração abaixo
  do resultado; empilhado abaixo disso. Evita três colunas ilegíveis em 1024 px.
- Ícones decorativos, nomes acessíveis, controles nativos por teclado, foco visível,
  status `aria-busy`, confirmação com Cancelar/Escape e cabeçalhos ordenáveis com
  `aria-sort`. Controles/avisos novos possuem PT-BR/en-US; nomes salvos pelo usuário
  não são traduzidos/regravados como se fossem textos da aplicação.
- `packages/npm test`: **39 testes**. `app/npm test`: **19 testes**. Builds dos dois
  workspaces aprovados. O build web mantém aviso de chunk lazy >500 kB; não foi
  validado desempenho de grandes históricos no desktop.
- Regressão usa o adapter F1 real com reader sintético e **EChartsRenderer real**:
  abrir modelos v2/v3 intactos sem confirmação, normalização de objetos/filtros,
  idioma, presets, pizza SVG, edição real/Cancelar, renomear/salvar e restauração
  de padrão ausente sem sobrescrever padrões editados nem descartar rascunho.
- Preview separado, com calendários/pessoas/equipes/modelos **inventados**, somente
  em memória. `?model=teams` abre a pizza por controles reais; `?model=cumulative`
  abre barras com a métrica intuitiva. `?selected` exercita filtros/comparação.
  `examples/synthetic-models.mjs` não é usado como fallback da biblioteca/app.
- Capturas Firefox headless em perfis temporários isolados, aguardando SVG/tabela:
  `/tmp/opencode/sandbox-ui-20261112-pie.png`, `-cumulative.png` e `-mobile.png`.
  Servidor loopback encerrado e porta verificada livre ao terminar.

Screenshots/jsdom não substituem Tauri/WebKitGTK, leitor de tela, IPC real,
concorrência SQLite ou inspeção de dados históricos pessoais. Nenhuma dessas fontes
foi acessada aqui. O fechamento/navegação externa do shell ainda deve respeitar
`onDirtyChange`; esta biblioteca protege suas trocas internas, não impede desmontagem
forçada pelo host. Nenhum servidor persistente foi adicionado.
