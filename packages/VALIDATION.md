# Registro de validação da sandbox

## Revisão funcional/visual — 12/11/2026

- `packages/npm test`: **39 testes aprovados**; `app/npm test`: **19 testes
  aprovados** (58 no total), somente readers/invokes/records sintéticos.
- Builds TypeScript dos pacotes e `app/npm run build`: aprovados. O build web
  mantém aviso de chunk lazy grande (~694,13 kB minificado / 229,98 kB gzip).
- `npm run size`: renderer **582385 bytes / 200646 gzip**; UI **100291 bytes /
  30062 gzip**, React externo. Sem novas dependências, eval ou gráficos não solicitados.
- Regressão com **adapter F1 e EChartsRenderer reais**, usando somente fixtures:
  pizza SVG, modelos padrão/usuário na mesma gestão, v2/v3 intactos sem prompt,
  troca de idioma/normalização, presets com baseline limpa e desvinculada, edição
  real com confirmação/Cancelar, retorno à configuração original, foco de renomear,
  título aparado, salvar e restaurar um padrão ausente sem sobrescrever os demais
  nem perder um rascunho. Também testa Unicode/ordem/repetição nos filtros canônicos.
- Preview sintético com modelos/calendários inventados em memória; nenhum IPC,
  SQLite ou snapshot pessoal. Chromium conectado confirmou pizza com SVG real,
  duas linhas, nenhum diálogo/aviso dirty e console sem erros. Captura Chromium
  indisponível pela janela não visível; não foi alegada como screenshot.
- Capturas reais Firefox headless, perfis temporários isolados, aguardando
  SVG/tabela após ações do harness: desktop 1672×1100 (pizza), 1024×1800 (barras e
  configuração abaixo) e móvel 390×3000 (pizza/configuração empilhadas).
  Arquivos: `/tmp/opencode/sandbox-ui-20261112-pie.png`, `-cumulative.png`, `-mobile.png`.
- Servidores de preview encerrados após a captura; confirmação TCP de porta 4179
  livre. Nenhum servidor persistente deixado aberto. `git diff --check` aprovado.
- Necessário tocar somente dois arquivos de host nesta rodada: `analysis-screen.tsx`
  para injetar restauração na gestão unificada e `analysis-provider.ts` para rótulo
  localizado da medida. Comparação com cópias prévias confirma nenhuma mudança do
  algoritmo F1. Nenhuma edição em SQL, migrations, backend nativo ou dados reais.

Handoff/diagnóstico: [`SANDBOX_UI_RECOVERY.md`](../docs/SANDBOX_UI_RECOVERY.md).
Tauri/WebKitGTK, leitor de tela, IPC e dados históricos pessoais não foram validados.
Versões/semânticas existentes e modelos persistidos não foram migrados ou apagados.
Alterações preexistentes da integração preservadas; sem commit/push.

## Desbloqueio do contrato de acumulados — query/modelo v3

- Leitura do bloqueio em `docs/F1_SANDBOX_V2_STATUS.md`; alterações desta rodada
  limitadas a `packages/` e documentação. Alterações preexistentes da integração
  em `app/` foram preservadas, sem edição, reversão ou commit. Sem dados reais/SQLite.
- `npm test`: **37 testes aprovados**, incluindo regressões v1/v2, seletor de
  temporadas F1 adaptado às facetas atuais e cinco novos testes de contrato/UI v3.
- `npm run build`/build TypeScript executado por test e size: aprovado.
- `npm run size`: aprovado. Renderer **582385 bytes / 200646 gzip**; UI
  **93354 bytes / 27952 gzip** (React externo, bundles minificados em memória).
- `node scripts/visual-smoke.mjs --build-only`: bundle sintético aprovado;
  cenário `?selected` adaptado para checkboxes de temporadas, sem iniciar servidor.
  Não constitui nova verificação visual do layout.
- `git diff --check`: sem erros de whitespace.
- V3 testado com grão de quatro dimensões, partições independentes de campanha/
  entidade, visitas ordenadas pelo provider (não pelo código lexical), agregação
  de ocorrências antes da janela e dois filtros pós-cálculo simultâneos.
- Confirmado que mostrar só visitas finais inclui visitas iniciais anteriores e
  mostrar só iniciais inclui finais anteriores; não inclui posteriores. Nulos
  anteriores continuam desconhecidos. Cronologia ausente **fora do recorte** ou
  ambígua recusa o cálculo; UI informa o erro e não permite salvar sem resultado.
- Modelos v1/v2 não recebem perfis/extras. Store/parser v2 rejeitam v3 em vez de
  descartar os campos. Store v3 volátil testa leitura v2/v3, CAS e roundtrip latest.
  UI testa bloqueio de gravação com store v2 e reabertura com store v3 opt-in.

Handoff para Terra: [`SANDBOX_V3_ACCUMULATION.md`](../docs/SANDBOX_V3_ACCUMULATION.md).
Ainda pendentes: perfil/cálculo/cronologia F1 real, suporte nativo ao modelo v3,
backend/IPC, histórico incompleto real, Tauri/WebKitGTK e acessibilidade assistiva.

## Extensão da biblioteca — 10/11/2026

- Escopo desta extensão: somente `packages/` e documentação sandbox. Nenhuma edição
  em `app/`, dependências do app, SQLite ou dados pessoais; nenhum commit realizado.
- `npm test` em `packages/`: **32 testes aprovados**, incluindo os 26 anteriores
  adaptados à configuração única à direita e seis novos testes de v2/UI.
- `npm run build` (também executado por test/size): TypeScript aprovado.
- `npm run size`: aprovado; bundles ESM minificados em memória com React externo:
  renderer **582385 bytes / 200646 gzip**; UI **84025 bytes / 25430 gzip**.
  Pizza/dispersão são agora módulos intencionais. Mantida verificação contra
  `eval/new Function` e gráficos não solicitados. Não são tamanhos do instalador.
- `git diff --check`: sem erros de whitespace.
- SVGs **reais** de pizza/dispersão renderizados pelo ECharts em SSR, além de
  testes de pares nulos, negativos, zeros, medidas incompatíveis e magnitude limite.
- Golden JSON v1 e acumulado legado preservados; teste explícito de análise fixa
  anterior à capacidade de multisseleção sem adição silenciosa de agrupamentos.
- Query v2 testada com cálculo antes do recorte, partição por entidade/campanha,
  ordem de exibição descendente sem inverter a janela e resposta na versão correta.
- Store volátil CAS testado para criar/renomear/abrir/atualizar/excluir/conflito;
  reader sintético atualizado demonstra modelo latest novo vs análise pinned antiga.
- UI jsdom: três campanhas, busca real na faceta, ordenação por cabeçalho,
  Alt+↑ nas colunas, visibilidade/ordem/sort persistidos ao reabrir, avisos dirty,
  Cancelar/Confirmar locais, `beforeunload`, notificações ao host e conflitos CRUD.

Nenhum teste usa dados de produção ou cria modelos fictícios no componente. Novas
capturas de layout, desktop Tauri, IPC/store durável, WebKitGTK/CSP, leitor de tela,
zoom e carga real do backend **não foram validados nesta extensão**. O renderer
continua usando ResizeObserver com o teste de resize anterior aprovado. Terra deve
implementar/habilitar os contratos F1/latest/model store conforme
[`SANDBOX_V2_HANDOFF.md`](../docs/SANDBOX_V2_HANDOFF.md).

## Revisão de UI e integração — 08/11/2026

- `packages/npm test`: **26 testes aprovados**, incluindo o adapter F1 real com
  reader sintético, nomes, temporadas, filtros de pilotos/equipes/rodadas/sessões,
  presets, comparação, campos espelhados, gráfico/tabela, preview e salvar/abrir.
- `app/npm test`: **12 testes aprovados**; nenhum banco pessoal acessado.
- `app/npm run build`: aprovado. Vite continua avisando que o chunk lazy da análise
  é maior que 500 kB minificado (~622 kB, ~209 kB gzip); não é erro de compilação.
- `git diff --check`: sem problemas de whitespace.
- `npm audit --omit=dev` no workspace dos pacotes: nenhuma vulnerabilidade conhecida.
- Verificação Chromium com CSP restritiva: nomes selecionados corretamente,
  42 linhas iniciais → 1 participante/temporada = 14 linhas → duas temporadas = 28;
  cenário com dois pilotos/duas temporadas = 56 linhas e quatro séries, sem erros
  de console na captura realizada.
- Layout medido no Chromium: painéis ~322/965/322 px num viewport de 1696 px
  (20/60/20, descontando gaps), sem overflow horizontal de página. Também foi
  observado o layout de três painéis num viewport de 1000 px.
- A captura revelou largura SVG antiga após ampliar a janela. O renderer agora
  envia novas medidas a `resize`; teste verifica 480→960 px e descarte de
  observer/chart. Após a correção, o SVG medido tinha 909 px para container de 909 px.
- Capturas Firefox headless com perfil temporário isolado: 1672×1100, 1024×1100 e
  390×2600, dados inventados, checkboxes reais acionados pelo harness e SVG/tabela
  aguardados antes da captura. Arquivos de sessão:
  `/tmp/opencode/rds-sandbox-desktop.png`, `rds-sandbox-compact.png` e
  `rds-sandbox-mobile.png` no mesmo diretório.
- Preview servido apenas em loopback, com expiração automática; encerrado ao fim
  da verificação. Nenhum servidor persistente adicionado.

Não foi iniciado o aplicativo Tauri, executada sincronização nem aplicada migration.
IPC, persistência real do host, WebKitGTK, leitor de tela e grandes bases continuam
pendentes de validação específica. Os screenshots provam o layout com fixtures,
não a correção/completude de dados históricos reais. Guia: `docs/SANDBOX_UI.md`.

## Registro original da biblioteca isolada — 07/11/2026

Ambiente: Linux, Node 24.18.0, npm 11.16.0. Nenhum servidor iniciado.
Instalação reproduzida com `npm ci --ignore-scripts` no workspace `packages/`.

## Resultados

- `npm test`: build TypeScript estrito + **23 testes aprovados**, sem falhas.
- Testes sem rede e sem banco: somente fixtures sintéticas de colheita.
- Contratos, versões, tipos, decimais exatos, filtros, nulos, comparação,
  dimensões obrigatórias e acumulados particionados verificados.
- Ciclo React/jsdom: consulta, configuração, faceta, filtro, salvar/abrir,
  exportação, troca de idioma, desmontagem e descarte de resposta antiga.
- Resultados parciais bloqueiam salvar/exportar/gráficos.
- Store em memória testa compare-and-swap e conflito, não durabilidade em disco.
- Renderer modular gera SVG real via ECharts SSR; strings de fonte não viram HTML.
- Carga sintética de 5000 linhas: validação + modelo gráfico + CSV em cerca de
  **42 ms** na execução registrada. Não mede agregação nativa, IPC, renderização
  de 5000 pontos no WebView ou RAM de longo prazo; não é um SLA.
- `npm audit`: **0 vulnerabilidades conhecidas** na árvore instalada auditada.
- `npm audit signatures`: **41 assinaturas de registry verificadas**;
  **18 atestações disponíveis verificadas**. Isso não valida todos os binários
  opcionais de outras plataformas nem comprova ausência de código malicioso.
- `npm run notices`: textos de runtime/peers e NOTICE Apache extraídos com sucesso.
- Diff dos arquivos existentes de `app/`, README, LICENSE e `.gitignore`: vazio.

## Bundle amostral

`npm run size`: esbuild 0.28.2, ESM browser ES2022, minificação e comentários
legais preservados, **React externo**. Sem arquivos de release gravados.

| Amostra | JS minificado | gzip |
|---|---:|---:|
| Adapter + ECharts SVG/linha/barra | 555166 bytes | 191199 bytes |
| UI React + core + contratos | aproximadamente 44 KB | aproximadamente 14,5 KB |

São bundles separados de medição: não somar como medida exata do instalador.
O bundle final pode compartilhar módulos, adicionar runtime React e ter outra
configuração de tree-shaking. Não foi usado o tamanho descompactado npm como
estimativa do executável.

A checagem amostral não encontrou `eval/new Function` no JS emitido nem contribuição
de pie/map/scatter na saída do renderer. Não é análise formal de fluxo de dados.

## Não validado / responsabilidade da integração

- Aplicação Tauri, IPC, SQLite, banco do usuário, sincronização e restauração.
- CSP aplicada por WebKitGTK; jsdom e SSR não a aplicam.
- Aparência e layout nos breakpoints, zoom 200%, contraste e leitor de tela real.
- Teclado em todas as combinações de WebView/OS e métricas de acessibilidade formais.
- Efetividade do cancelamento no backend, persistência após reinício, atomicidade
  de exportação nativa e concorrência entre processos.
- Performance e memória com temporadas reais, centenas de milhares de linhas,
  grande cardinalidade e renderização prolongada.
- Instaladores, Windows/macOS, SBOM completo e revisão jurídica dos dados reais.

Limites funcionais completos: [README.md](README.md).
Integração e responsabilidades: [SANDBOX_INTEGRATION.md](../docs/SANDBOX_INTEGRATION.md).
