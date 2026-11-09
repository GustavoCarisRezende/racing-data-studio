# Registro de validação da sandbox

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
