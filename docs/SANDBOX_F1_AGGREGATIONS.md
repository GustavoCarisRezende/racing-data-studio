# Agregações de pontos F1

## Estado na beta

Pontos oferecem soma, média, mínimo e máximo com propagação de nulos e decimais exatos. A descrição de teste pendente registra a época da alteração; consulte testes atuais antes de concluir cobertura.

Além da soma, o adapter oferece média, mínimo e máximo por grupo de resultados
observados. Todas propagam valores de pontos ausentes: um grupo que contém qualquer
valor nulo retorna nulo, não zero nem uma média parcial. Nenhuma é classificação
oficial. A contagem de ocorrências mantém sua semântica anterior.

A média usa inteiros arbitrários, sem conversão para ponto flutuante. É arredondada
para longe de zero em empates, com o maior entre 12 casas decimais e o número de
casas da entrada. O resultado é texto decimal; caso exceda o limite do contrato,
a consulta falha explicitamente. A tela também informa o arredondamento. Gráficos
continuam usando aproximações numéricas para desenhar.

Consultas e documentos existentes não são regravados. O armazenamento nativo foi
estendido para aceitar as novas opções nos formatos atuais, mas versões antigas do
aplicativo F1 podem rejeitar modelos que usem essas opções, inclusive ao listar
modelos; não se deve compartilhar esse banco com uma versão anterior sem backup.
O comportamento nativo das agregações ainda precisa de teste de integração Rust
isolado.

Ordenação multicoluna, agrupamento visual e nomes de evento são descritos em
[SANDBOX_TABLE_V2.md](SANDBOX_TABLE_V2.md).
