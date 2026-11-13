# Segurança, dependências e distribuição

## Origem e versões

Revisão em 07/11/2026. ECharts 6.1.0 foi conferido no registry oficial npm
(`https://registry.npmjs.org/echarts`) e na documentação/repositório da Apache:

- [Importação modular](https://echarts.apache.org/handbook/en/basics/import/).
- [Segurança das APIs](https://echarts.apache.org/handbook/en/best-practices/security/).
- [SVG/Canvas](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/).
- [Acessibilidade](https://echarts.apache.org/handbook/en/best-practices/aria/).
- [Repositório](https://github.com/apache/echarts).

O lockfile registra URL e integridade de todos os pacotes. Integridade não comprova
ausência de código malicioso. Dependências diretas estão fixadas; transitivas são
fixadas pelo lockfile. Não usar atualizações automáticas nem `npm audit fix --force`.

Runtime do renderer: ECharts 6.1.0 (Apache-2.0), zrender 6.1.0 (BSD-3-Clause),
tslib 2.3.0 (0BSD). ECharts também inclui partes BSD-3-Clause, como d3 em utilitários.
React é MIT e peer dependency. A tabela não substitui os textos de licença.

React/DOM 19.3.1, seus tipos 19.3.0, TypeScript 7.0.2, jsdom 31.0.0 e esbuild
0.28.2 são dependências de desenvolvimento do workspace. jsdom e esbuild não
devem ser empacotados no aplicativo. Não foram adicionados loaders remotos,
instrumentação de analytics ou pacotes de IA.

A instalação foi feita com `--ignore-scripts`. Na validação, `npm audit` não
identificou vulnerabilidades conhecidas; `npm audit signatures` verificou assinaturas
de registry e as atestações disponíveis. Repetir antes de distribuir: assinaturas
e uma auditoria sem alertas não equivalem a revisão completa de procedência.

## Threat model

Dados e configurações chegam como JSON não confiável, através de adapters confiáveis.
Um adapter JavaScript executável malicioso, getters ou objetos Proxy hostis já têm
execução no processo; este contrato não é um isolamento de execução de plugins.

- IDs são limitados; IDs reservados de protótipos são recusados.
- Versões futuras e combinações incompatíveis são recusadas.
- Documentos são projetados para campos conhecidos; nenhuma callback é restaurada.
- Não há SQL, linguagem de expressões, regex do usuário, HTML, URLs de imagens ou
  opções brutas ECharts no protocolo.
- Strings são renderizadas como texto React/SVG. Tooltips ECharts usam `richText`,
  não HTML. Não há links clicáveis originados da fonte.
- Resultados são verificados contra requestId, token de seleção, schema, tipos,
  limites, grupos e identidades. Exportação e gráficos recusam resultados incompletos.
- CSV prefixa apóstrofo em células textuais potencialmente executáveis por planilhas;
  comportamento de cada software de planilha ainda deve ser testado. Nulos e strings
  vazias ficam indistinguíveis no CSV; o manifesto declara isso.
- Dados, seleções e análises não são enviados para rede, log ou armazenamento pela UI.
  Provider, store e host determinam o I/O efetivo e devem ser auditados separadamente.

Backend deve repetir a validação. UI não é fronteira de autorização. Em Tauri, os
comandos novos precisam de capabilities mínimas; nenhuma permissão genérica SQL,
filesystem ou URL deve ser concedida à biblioteca.

## CSP e offline

O código próprio não requer Workers, WASM, Blob/data URLs, `eval`, scripts inline,
CDN, fontes remotas ou `unsafe-eval`. CSS é arquivo externo. ECharts é importado por
`core/charts/components/renderers`, com linha/barra/pizza/dispersão e SVG registrados.

Isso **não comprova compatibilidade com a CSP do Tauri**. ECharts/zrender manipulam
DOM e estilos em runtime; a distribuição real precisa ser testada com a política
existente, WebKitGTK e assets locais. Não liberar `unsafe-inline`, `unsafe-eval`,
hosts remotos ou `*` apenas para contornar erros. jsdom/SSR não aplicam a CSP do host.

Na integração, manter `default-src 'self'`, scripts locais autorizados pelo Tauri,
CSS local e somente o IPC necessário em `connect-src`. Não modificar a CSP neste
workspace. Se alguma exceção for comprovadamente necessária, revisar a API que a
causa e registrar justificativa mínima antes de autorizá-la.

Testar o aplicativo compilado sem rede e inspecionar console/network. O renderer
nunca busca dados; chamadas remotas só podem vir de um provider/host introduzido
na integração, não destes pacotes.

## Créditos e licenças

`npm run notices` imprime os textos instalados de LICENSE/NOTICE e subcomponentes
de ECharts, zrender, tslib, React/DOM e scheduler. O empacotador deve preservar
os textos aplicáveis no instalador e na seção de créditos, incluindo:

> Apache ECharts
> Copyright 2017-2026 The Apache Software Foundation
>
> This product includes software developed at
> The Apache Software Foundation (https://www.apache.org/).

Ao distribuir estes pacotes isoladamente, incluir também o `LICENSE` Apache-2.0
da raiz. Atualmente são privados e não existe processo de publicação/release.
O gerador de avisos é um auxílio para a árvore atual, não um scanner completo de
licenças nem substituto de SBOM e revisão do bundle final.

Os dados sintéticos dos testes são Apache-2.0. Isso não altera a licença de datasets
reais: o provider precisa declarar atribuição/licença/limitações, que acompanham o
manifesto exportado. Dados Jolpica, quando integrados, não se tornam Apache-2.0.

## Antes de release

1. Revisar diff do lockfile, identidade, scripts e integridades.
2. Repetir auditoria de vulnerabilidades e assinaturas/atestações disponíveis.
3. Gerar SBOM do produto completo, incluindo dependências Rust da integração.
4. Preservar avisos e licenças de todos os componentes efetivamente distribuídos.
5. Testar CSP, offline, exportação nativa e leitor de tela no aplicativo compilado.
6. Não afirmar segurança, acessibilidade ou suporte multiplataforma com base apenas
   na suíte Node deste workspace.
