# Comportamento dos gráficos: acumulados e eventos

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
