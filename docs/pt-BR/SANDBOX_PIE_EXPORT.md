# Pizza e exportação

## Comportamento atual

Pizza, CSV e SVG/PNG estão disponíveis quando compatíveis. O host atual exporta um CSV ou uma imagem, sem manifesto e sem JPEG; as seções históricas abaixo descrevem um fluxo anterior.

As opções da pizza são opt-in em `visualization.pie.version: 1`. Sem esse campo,
ordem e apresentação de modelos anteriores permanecem iguais. A edição permite
ordenar por valor crescente ou decrescente, mostrar/ocultar legenda e rótulos e
agrupar valores **estritamente menores** que um limite decimal não negativo.
O valor do limite usa ponto como separador. O usuário aplica ao sair do campo ou
pressionar Enter; entrada inválida é recusada e a configuração anterior preservada.

O limite e a ordenação comparam os valores originais como decimais, e “Outros”
soma esses valores com inteiros arbitrários. “Outros” fica sempre no fim, mesmo
quando a soma dele seria maior que outras fatias. Nulos são omitidos e sua
quantidade é informada; negativos continuam recusados. A tabela permanece com
as linhas originais. Se o total exceder os limites do contrato ou do gráfico,
a operação falha em vez de truncar ou usar infinito. A renderização ECharts é
numérica aproximada, mesmo quando a comparação e a soma foram exatas.

“Outros” é a **soma dos valores das fatias**, não uma nova consulta ao provider.
Portanto, ao selecionar médias ou contagens distintas, não representa a média ou
contagem distinta recalculada da união dos grupos. A interface avisa essa diferença.
As preferências também ficam preservadas ao mudar para outro tipo de gráfico.

O store nativo valida o novo campo; modelos existentes não são regravados apenas
ao abrir. **Versões anteriores do aplicativo não entendem o campo e podem falhar
ao listar modelos novos que o contenham**. Não há conversão ou downgrade automático.

## CSV experimental no host F1

O host oferece CSV e manifesto em dois diálogos nativos separados. A exportação
usa todas as linhas do resultado completo, na ordem e com as colunas da tabela,
não apenas a página atual. Resultados incompletos são recusados. O CSV usa vírgulas
e protege células de texto que possam ser interpretadas como fórmulas. O manifesto
inclui licenças, fontes, filtros, revisões e configuração; pode conter informações
privadas e deve ser compartilhado conscientemente. Nada é enviado pela rede.

O backend utiliza `tauri-plugin-dialog` oficial 2.8.4 fixado no Cargo.lock. O
frontend não recebe nem fornece caminhos; cada arquivo exige escolha no diálogo.
Não se concedeu permissão genérica de filesystem ou de diálogo ao frontend.
A escrita limita cada arquivo a 16 MiB, exige extensão esperada e usa criação
exclusiva, sem sobrescrever arquivos existentes ou seguir symlink final. Pastas
intermediárias são resolvidas pelo sistema operacional. Em Unix, o arquivo é
criado com permissões solicitadas `0600`; o controle de acesso final depende
também do filesystem e da plataforma. O cancelamento ou uma
falha no segundo diálogo pode deixar o primeiro arquivo já salvo; falha de escrita
pode deixar um arquivo incompleto. É necessário escolher nomes novos.
Interromper a tela não fecha necessariamente um diálogo nativo já aberto;
uma seleção já confirmada ainda pode concluir a escrita.

Foram testados o gerador com dados sintéticos e a escrita exclusiva em diretório
temporário, mas **o seletor real e o fluxo completo Tauri ainda não foram
validados** em ambiente gráfico. Esse recurso não deve ser considerado validado
em produção até testar os diálogos, permissões e cancelamento na plataforma alvo.

## Imagens experimentais

SVG, PNG e JPEG usam o mesmo modelo e opções de desenho do ECharts. O exportador
gera SVG isolado com título e legenda própria, sem interpolar texto de usuário
como marcação. O usuário escolhe independentemente incluir legenda e rótulos
das fatias; essas escolhas não alteram o modelo salvo. PNG usa fundo transparente;
JPEG usa fundo escuro para preservar contraste. PNG/JPEG são rasterizados em
Canvas local a partir de um Blob SVG; não há busca externa. A CSP permite `blob:`
apenas em imagens. URLs temporárias, handlers e Canvas são liberados ao terminar,
cancelar ou falhar; carregamento e codificação têm timeout de 15 segundos.

A imagem tem largura 1200 px, gráfico de 600 px de altura e legenda abaixo.
A legenda quebra linhas e rejeita o resultado se ultrapassar o limite de altura;
textos, pontos e arquivos têm limites explícitos (imagem até 8 MiB). Uma legenda
muito longa, falha do Canvas ou extensão incompatível gera erro, não corte
silencioso. O seletor nativo aceita somente SVG, PNG ou JPEG com a extensão
correspondente; a criação continua exclusiva, sem sobrescrever arquivos.
O comando valida limite, codificação e assinatura básica, **não é um sanitizador
geral de SVG arbitrário**. A segurança dos dados normais depende da construção
controlada do SVG e do escaping de textos, não de aceitar SVG fornecido pelo usuário.

Foram testados ECharts SVG com entradas sintéticas hostis, opções independentes,
rasterização com Canvas simulado, limpeza e validação nativa de payload. **Não
foram testados o WebView real, a fidelidade visual da rasterização, a transparência
efetiva, a CSP ou o diálogo gráfico integrado.** As imagens não devem ser
consideradas validadas para produção até esses testes de plataforma. O layout de
exportação usa dimensões fixas e pode diferir do painel redimensionado da tela.
