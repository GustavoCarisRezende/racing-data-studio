# Tabela: ordenação, agrupamento e rodadas

## Estado na beta

Ordenação multicoluna e resumo por nova consulta permanecem recursos atuais; resumo não soma linhas agregadas e pode modificar a semântica dos filtros. Confira o contrato v3 para perfis.

Modelos existentes continuam com `table.version: 1`; abrir ou consultar não os
converte nem salva. Ao adicionar uma segunda ordenação ou selecionar agrupamento,
a edição passa a usar `table.version: 2`, com `sorts` na ordem de prioridade dos
cliques e `groupBy` opcional. Excluir uma prioridade preserva a ordem das demais.
O cabeçalho alterna crescente, decrescente e sem ordenação. Nulos ficam por último.

O agrupamento é de apresentação: não soma nem modifica resultados. A dimensão
agrupada fica primeiro na ordenação; as prioridades escolhidas atuam dentro de
cada grupo. A paginação pode repetir o cabeçalho de um grupo na página seguinte.
O campo agrupado deve estar visível. Ao ocultá-lo, o agrupamento é removido.

Para alterar o grão analítico, use a ação separada **Recalcular totais da tabela**.
Ela remove o acumulado e as outras dimensões não obrigatórias, preserva os filtros
como filtros de entrada, mantém a métrica/agregação selecionada e reconsulta o
provider; não soma linhas já agregadas. A ação descarta a configuração anterior
de colunas/ordenação/agrupamento visual, com aviso antes de aplicar. Por exemplo,
selecionar Piloto na F1 produz Piloto + Temporada obrigatória. As dimensões
resultantes são persistidas no documento v2/v3 existente, sem conversão automática.
Recortes antes aplicados após acumulados passam a filtrar antes da nova agregação.

O store nativo aceita e valida as duas versões. **Versões anteriores do aplicativo
não entendem tabela v2 e podem falhar ao listar modelos que a utilizem.** Não
compartilhe o banco com uma versão antiga sem backup; não há downgrade automático.
As validações de compatibilidade e CAS não alteram modelos antigos ao abri-los.

Na F1, o nome de evento vem do calendário da mesma revisão e temporada; ausência
do calendário ou nome mantém a rodada numérica. Se o mesmo número representa nomes
diferentes em temporadas selecionadas, eixo, faceta e cabeçalho de agrupamento usam
o número, em vez de atribuir incorretamente um dos eventos a todas as temporadas.
As células da tabela agrupadas por temporada conservam o nome daquela temporada.
O nome é um rótulo auxiliar, não uma nova identidade nem alteração de granularidade.
