# Comportamento dos gráficos: acumulados e eventos

## Comportamento atual

Acumulados por piloto, unificação de eventos e legendas continuam disponíveis. O preenchimento de lacunas é condicionado à integridade e cronologia; os resultados de teste abaixo são históricos, não validação atual.

## Lacunas nos acumulados

“Pontos após o evento” mantém o acumulado anterior quando um piloto já tem
resultados anteriores, mas não aparece numa sessão já realizada que contém
resultados de outros pilotos. A projeção nativa precisa ter validado a estrutura
e a paginação do endpoint. Pontos explicitamente iguais a zero também mantêm o
acumulado.

Não se preenchem eventos futuros, sessões sem resultados para ninguém, cobertura
desconhecida ou pontos explicitamente nulos. Não há preenchimento anterior à
primeira participação conhecida. A validação de paginação não prova completude:
uma lista parcial entregue pela fonte com totais coerentes pode ser
indistinguível de uma ausência de participação.

Esse preenchimento é do perfil de acumulado por piloto. O perfil agrupado por
equipe não inventa a equipe de uma participação ausente e pode conservar lacunas.

Na reprodução em leitura do backup local, Hadjar tem 71 pontos na rodada 11,
não tem resultados nas rodadas 12–14 e chega a 86 na rodada 15. O acumulado deve
mostrar 71 nas três rodadas intermediárias, não uma interrupção da linha.
O banco original não foi alterado para essa verificação.

## Unificar Eventos

O grupo **Comportamento dos gráficos**, à direita da sandbox, contém
**Unificar Eventos**. A opção fica habilitada quando Corrida e Sprint estão
explicitamente selecionadas. Sem ambas, a preferência pode permanecer salva,
mas não é enviada como comportamento ativo da consulta.

Novas visualizações F1 iniciam com **Corrida e Sprint marcadas** e o título
“Resultados dos eventos”. Presets específicos e modelos existentes mantêm
suas próprias seleções.
Nas visualizações F1 novas, a preferência começa marcada; isso não altera modelos
já salvos nem unifica uma consulta enquanto as duas sessões não estiverem
selecionadas.

- Desmarcada: mantém os registros separados por sessão.
- Marcada: consolida as sessões para cada combinação das demais dimensões.
- Em acumulados: usa o último acumulado cronológico da rodada, sem somá-los.
  Exemplo: 8 pontos anteriores + 2 da sprint + 18 da corrida = **28**.
- Em pontos simples com soma: os pontos da sprint e da corrida resultam em **20**
  nesse mesmo exemplo.

O contrato genérico usa `capabilities.eventUnification` no descriptor e
`unifyEvents` na consulta e na configuração da visualização. A propriedade é
opcional nos modelos existentes; não exige migration ou regravação deles.
A biblioteca não conhece os códigos de sessão F1 nem calcula sua cronologia.

## Filtros de pilotos

O filtro Pilotos aceita vários IDs de origem de uma vez. A consulta combina a
seleção desses IDs com os demais filtros e aplica-a igualmente entre temporadas
e sessões; nomes apresentados na legenda não substituem os IDs.

## Validação

A suíte da biblioteca passou com 68 testes, a aplicação com 31 e Rust com 44
(um teste de rede ignorado); o build web também passou.
A verificação independente do backup
confirmou os acumulados de Hadjar e a ausência de duplicação ao unificar.
A prévia no Chromium confirmou que a checkbox fica no painel direito, permanece
desabilitada com só Corrida e, com Corrida e Sprint explícitas, reduz seis séries
de três pilotos a três séries.

As verificações automatizadas e a prévia no navegador não substituem a validação
final no WebView do Tauri.

## Ajustes de seleção e configuração

- A legenda vinculada a facetas permite alternar vários pilotos por seus IDs,
  sincronizando com o filtro lateral e preservando temporadas e sessões.
  Remover a última seleção volta a “Todos”; opções não selecionadas continuam
  disponíveis. A lista vinculada carrega até 1.000 opções.
- Novas visualizações iniciam com a preferência de unificação marcada,
  inclusive quando sua aplicação está desabilitada pela seleção de sessões.
  Modelos existentes mantêm a preferência salva. O grupo fica retraído e é o
  último do painel direito.
- “Colunas da tabela” aparece apenas na tabela. “Campos” usa “Dimensão principal”
  em vez de “Eixo X”, sem duplicar o controle de agrupamento simples.
- O recálculo compatível aplica a seleção imediatamente. Operações incompatíveis
  com um perfil acumulado ficam indisponíveis, com explicação, sem apagar o
  perfil silenciosamente.

Esta revisão passou em 69 testes da biblioteca e 32 do aplicativo, além do build
web. A prévia Chromium confirmou multiseleção sincronizada, recálculo sem botão,
checkbox padrão marcada e os grupos condicionais e ordenados.

## Estabilidade da legenda e identificação de eventos pendentes

A legenda reserva espaço fixo para as amostras de cor e usa uma referência de
séries independente do filtro sincronizado. Selecionar pilotos não remove os
traços dos demais itens nem muda suas larguras ou ordem. As cores e os padrões
também são preservados no gráfico e na exportação. Consultas vazias ou com erro
mantêm a legenda utilizável sem exibir pontos antigos. Uma referência
indisponível mantém o espaço reservado para séries ainda desconhecidas.

Em **Explorar eventos**, o contorno vermelho e o rótulo **Pendente** identificam
eventos futuros ou sem qualquer resultado local de corrida/sprint. Quando há
horário com fuso explícito, a comparação usa o instante completo; sem ele, usa
a data civil. O marcador não altera nem sincroniza dados.

Validação desta correção: 70 testes da biblioteca, 37 do aplicativo e build web
aprovados. No Chromium, foram comparados tamanhos, posições e traços da legenda
após multiseleção e verificado o contorno vermelho dos eventos com dados
sintéticos. A validação no WebView nativo continua pendente.

## Unificar Legendas

**Unificar Legendas** fica em **Comportamento dos gráficos**. Marcada (padrão),
agrupa as séries por piloto; a temporada aparece apenas nos swatches/linhas do
hover. Desmarcada, cada linha/série tem uma entrada própria e o rótulo inclui a
temporada. Os dois modos ordenam os rótulos alfabeticamente de acordo com o
locale. `visualization.unifyLegends` é opcional em modelos v2/v3:
quando ausente, equivale ao padrão marcado; não requer migration nem regravação
de modelos antigos. A opção altera somente a apresentação da legenda, não os
dados nem os agrupamentos da consulta. A validação desta opção no WebView nativo
ainda não foi feita.

Nos dois modos, os cliques continuam filtrando pelo ID do piloto, sem mudar as
temporadas selecionadas. A prévia Chromium com duas temporadas confirmou os
nomes sem ano no modo unificado, os títulos de hover individuais por cor e seis
entradas com ano em ordem alfabética no modo separado (três pilotos).
A verificação passou em 71 testes da biblioteca, 37 da aplicação e 44 de Rust
(um teste opcional de rede ignorado), além do build web.

## Tooltip de linhas coincidentes

No gráfico de linhas, o tooltip reúne as séries visíveis que têm o mesmo índice
de categoria (X) e valor numérico projetado (Y). Linhas com outro Y no mesmo X,
ou o mesmo Y em outro X, não entram no grupo. Zero é um valor válido; pontos
nulos não são incluídos. Nomes de pilotos e temporadas continuam identificando
cada registro. Barras, pizza e dispersão mantêm seus tooltips individuais.

Esta alteração passou em 74 testes da biblioteca e 38 da aplicação, além do
build web. No Chromium com ECharts SVG real, o ponto compartilhado por duas
séries mostrou os dois registros; outro ponto com o mesmo Y em outra rodada
mostrou somente sua própria série.
