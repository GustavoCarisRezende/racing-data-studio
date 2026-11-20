# Usabilidade desktop e gerenciamento de snapshots

## Comportamento atual

Tutorial opcional, snapshots, reset nativo e recuperação de desenvolvimento estão disponíveis. Validações descritas abaixo têm escopo e data próprios; não equivalem à validação completa de todas as plataformas.

## Interface

### Janelas desktop com pouca altura

Com largura efetiva de pelo menos 900 pixels CSS e altura útil de aproximadamente
850 pixels ou menos, normalizada para zoom de 100%,
o título da categoria aparece centralizado no cabeçalho da aplicação.
O conteúdo mantém seu título semântico para leitores de tela, sem exibir um
segundo título. Janelas mais altas mantêm o título original no conteúdo.

A regra considera a área útil, não a resolução física do monitor: escala do
sistema e decorações da janela afetam o espaço disponível. Reduzir o zoom não
desativa o modo compacto só porque a altura CSS aumenta. Redimensionar a janela
continua atualizando o layout. No modo compacto,
o cabeçalho e a navegação têm menos espaçamento, a descrição vazia deixa de
reservar espaço e o título do construtor divide a linha com os controles de
visualização/edição. A altura do gráfico se adapta entre 220 e 310 pixels.
Os controles mantêm o tamanho normal; configurações, tabelas e legendas longas
continuam acessíveis por rolagem. Layouts estreitos/móveis mantêm o fluxo
empilhado, sem cortar conteúdo.

### Zoom da interface e ajuste à janela

O zoom desktop usa o WebView nativo, não uma transformação CSS. **Ctrl +** (ou
**Ctrl =**) aumenta, **Ctrl −** diminui e **Ctrl 0** retorna a 100%; **⌘** também
funciona no macOS. O menu do cabeçalho mostra a porcentagem atual e controles
para aumentar, diminuir e redefinir. Os níveis manuais vão de 70% a 200%.
O nível aplicado é salvo localmente e restaurado na abertura; armazenamento
indisponível não impede alterar o zoom na sessão.

**Ajustar à janela** é uma ação explícita no menu. Considera a visualização
principal (inclusive a legenda), ou o conteúdo atual quando não há visualização.
Mede o layout real em 100%, 95%, 90% e 85%, parando no primeiro que cabe ou mantendo
o melhor layout legível. Assim considera os breakpoints responsivos, sem reduzir
continuamente o documento inteiro para eliminar toda rolagem. Tabelas, legendas
e configurações longas ainda podem exigir rolagem.

A escala escolhida é mantida, mas o ajuste não fica ativo ao redimensionar.
Acione-o novamente se necessário. O zoom não altera filtros, modelos ou dados
importados. Erros nativos preservam o nível anterior quando possível; falhas ao
salvar a preferência são informadas separadamente. A prévia web mantém os
controles nativos de zoom desabilitados. O comando IPC `set_application_zoom`
é restrito à janela principal e valida um fator finito entre 0.7 e 2.0;
nenhuma permissão genérica de WebView é concedida ao frontend.

### Tutorial de primeiro acesso

No primeiro acesso, um tutorial opcional apresenta a tela inicial, categorias,
sincronização, snapshots, fonte dos dados, exploração e os principais controles
do Sandbox. Popups apontam para os controles enquanto o restante da tela fica
escurecido. “Pular tutorial” encerra o guia; a conclusão ou dispensa fica salva
localmente, separada dos modelos.

O menu hambúrguer **Como usar o sistema**, à direita do idioma no cabeçalho,
reinicia o guia na tela inicial. Alterações não salvas exigem confirmação antes
do reinício. Quando já existem snapshots, nenhuma nova sincronização é exigida.
Sem dados, o guia sugere a temporada do ano anterior: a seleção e a importação
dependem de ações explícitas, e o guia só avança após o sucesso. Uma falha permite
repetir a operação ou sair. No navegador ou com controles indisponíveis, o guia
oferece explicações sem executar operações nativas.

Os textos acompanham o idioma escolhido. O teclado permite acessar os controles
do popup, focar o recurso destacado e sair com Escape. O guia não altera modelos,
filtros ou snapshots automaticamente. O script de reset também remove a marca
local de conclusão/dispensa do tutorial.

- Todas as abas da Fórmula 1 usam a mesma largura, tipografia e posição do menu
  anteriormente adotadas pela sandbox. O título e a área de descrição não mudam
  a altura da navegação ao trocar de aba.
- A busca por ano fica dentro da lista pesquisável de temporadas e filtra o
  catálogo já carregado, sem chamadas de rede por tecla. O gatilho identifica o
  ano confirmado; digitar não confirma outra temporada automaticamente.
  “Apenas temporadas não sincronizadas”, à direita, combina a busca com os anos
  sem snapshot local. Se a seleção não for válida ou o catálogo local não puder
  ser verificado, a importação permanece desabilitada.
  Setas navegam com rolagem até a opção ativa; Enter ou clique confirmam e
  devolvem o foco ao gatilho. Escape, Tab e clique fora fecham a lista sem
  confirmar outro ano.
- As informações estáticas de importação e do último snapshot ficam em um
  accordion fechado por padrão. Progresso e erros continuam visíveis fora dele.
  A linha fica alinhada à esquerda na ordem Temporada, seletor, Atualizar/Importar
  e checkbox, com quebra responsiva e margem de 16px antes do accordion.
- “Sobre o projeto” resume finalidade, primeiros passos, dados e privacidade,
  contribuição de novas categorias e licenças, em português e inglês. Novas
  categorias exigem implementação e registro de um módulo; não são instaladas
  automaticamente pela interface.

## Snapshots

### Campos de resultados no sandbox

Os resultados de corrida e sprint preservados nos snapshots também fornecem
posição de largada, posição final na classificação e voltas completadas. O saldo
de posições é calculado como largada menos posição final: positivo indica ganho
líquido de posições, não uma contagem de ultrapassagens.

Uma largada informada como zero não é uma posição válida para essa comparação;
nesses casos, a posição de largada analítica e o saldo ficam desconhecidos.
Valores ausentes permanecem nulos; zero voltas completadas é válido.
Os JSONs originais são preservados e não é necessário consultar novos endpoints.
Posições são referentes a cada sessão, não à classificação do campeonato.
Posições e saldo oferecem média, mínimo e máximo, sem soma nem acumulado.
Voltas também permitem soma. Ao unificar corrida e sprint, as agregações usam
as ocorrências originais de ambas as sessões; não representam uma posição única
do evento. Para posições, preferir tabela, linhas, barras ou dispersão: fatias
de médias em pizza não representam partes de um total.

O SQLite continua autoritativo. A migration 9 adiciona uma tabela separada de
nomes visuais; não recria a tabela de páginas nem regrava documentos existentes.
A migration 10 registra o snapshot ativo de cada temporada e inicialmente
seleciona a versão de maior ID. “Tornar ativa” muda essa seleção sem copiar
dados; o marcador verde “Ativa” não depende da ordem da lista. Consultas atuais
usam essa seleção; referências fixas continuam usando seus IDs originais.

Toda sincronização bem-sucedida cria e ativa uma versão nova, mesmo quando as
páginas são idênticas. Nesse caso, a data de origem é preservada. As verificações
contra redução de dados continuam comparando a versão mais recente armazenada,
não uma versão histórica ativada pelo usuário.

- Nomes são aparados, limitados a 80 caracteres e não aceitam caracteres de
  controle. A chave de comparação desconsidera diferenças de caixa e algumas
  variantes Unicode; não é uma normalização canônica Unicode completa.
- A unicidade vale na mesma temporada. Nomes automáticos `Snapshot #<id>` são
  reservados para evitar colisões visuais. Confirmar o próprio nome automático
  sem alterá-lo não grava metadados.
- As ações ficam à direita do nome, na ordem Renomear, Criar cópias por evento,
  Restaurar e Excluir. A lixeira é a última opção, com rótulo acessível e sem
  texto visual adicional. O registro ocupa uma linha horizontal em telas largas
  e pode quebrar em telas menores. A exclusão exige confirmação modal.
- O snapshot ativo é protegido. Para capturas inativas, o aplicativo informa
  quais análises legadas serão excluídas junto com a captura e pede confirmação.
- A verificação da lista confirmada e a exclusão dessas análises, páginas e
  snapshot ocorrem na mesma transação de escrita.
- Renomear não altera IDs ou nomes de arquivos. Excluir não apaga cópias por
  evento já publicadas; essas cópias não são cópias completas do banco.
- Falhas de exclusão aparecem dentro do modal; conflitos de nome são mostrados
  junto ao campo de edição, sem depender de detalhes técnicos ocultos.

## Janela e links

O painel de modelos permite excluir registros atuais e análises legadas, com
revisão otimista para evitar excluir uma versão alterada por outra operação.
Após excluir ou cancelar a exclusão, volta à lista. “Nova visualização” inicia
uma configuração desvinculada; alterações não salvas exigem confirmação.
O nome é editado pelo ícone à direita do título e persistido ao salvar.

Os instantes das operações do sistema são exibidos no fuso local do usuário,
sem mudar os valores UTC armazenados. Datas e horários de eventos e dos dados
das análises não são convertidos. A ordem das ações depende do diálogo.

A janela Tauri inicia maximizada, não em tela cheia. F11 alterna a tela cheia
total e restaura a maximização anterior. Chamadas simultâneas e repetição
automática da tecla não geram alternâncias sobrepostas.

O GitHub é aberto por um comando nativo restrito à janela `main`, sem parâmetro
de URL ou caminho. A URL é fixa. A prévia web usa a abertura normal do navegador;
não recebe permissões nativas.

## Verificação

Os testes de interação devem comparar identidade de nós DOM por expressões
booleanas, evitando que diagnósticos de asserções tentem imprimir árvores jsdom
inteiras. Uma asserção incorreta do parentesco do seletor atingiu o limite de
3 GB; corrigida, a suíte focada passou com pico de aproximadamente 166 MB.
Para novas validações, usar execução serial, limite de heap e limites de memória,
swap e tempo no cgroup.

- Testes Rust cobrem preservação de páginas, análises e modelos na migration 9,
  nomes e conflitos, proteções de exclusão, persistência ao reabrir e rollback de
  páginas após uma falha injetada no DELETE do snapshot.
- Na prévia Chromium com IPC e dados sintéticos, foram conferidos posição das
  abas, busca local sem consultas extras, bloqueios e confirmação da exclusão,
  renomeação com ID preservado e erros localizados junto aos controles.
- No aplicativo nativo Linux, com dados isolados em `/tmp/opencode`, foi
  verificada a maximização inicial, entrada/saída de tela cheia via F11 e a
  ativação do link do rodapé. O lançador de navegador foi substituído no ambiente
  do teste para capturar a URL correta sem abrir uma página externa.
- O teste nativo usou XWayland. Windows, macOS, o navegador externo real e o uso
  completo do aplicativo em Wayland nativo ainda precisam de verificação.

As verificações automatizadas usam dados isolados. Separadamente, por solicitação
explícita do usuário, os dados locais do aplicativo foram apagados para reiniciar
os testes de desenvolvimento.

## Reset nativo e limpeza de desenvolvimento no Linux

O menu hambúrguer também oferece **Restaurar Configurações Padrão**, em
vermelho após um separador. No desktop, a opção abre um aviso de exclusão
permanente; abrir ou cancelar o aviso não limpa dados. Confirmar prepara a
limpeza e o reinício do aplicativo. Cancelar recebe o foco inicial por segurança,
e a ordem das ações depende do diálogo.

Na inicialização, a implementação nativa move os diretórios do app para pastas
temporárias vizinhas antes de abrir o banco e o WebView. Uma falha nessa etapa
desfaz as movimentações. Após confirmar essa etapa, a limpeza das pastas
temporárias pode ser retomada em outra inicialização. Isso inclui o armazenamento
local do tutorial. Exportações externas são preservadas.

O fluxo nativo foi conferido no Linux/XWayland com diretórios XDG isolados:
confirmação real via IPC, encerramento/reabertura, remoção dos arquivos de teste
em dados/configuração/cache/estado, banco reiniciado sem importações e retorno às
boas-vindas. Arquivos vizinhos fora das raízes do app foram preservados. Esse teste
não usou os dados reais do usuário; o reinício ainda não foi verificado em Windows
ou macOS.

Em desenvolvimento, o Vite pode ser encerrado pelo CLI ao reiniciar o aplicativo.
Por isso, o processo reaberto após a restauração usa uma cópia local da interface
de `app/dist`, pelo protocolo interno do Tauri, sem depender de `127.0.0.1:1420`.
O comando de desenvolvimento gera essa cópia antes de iniciar o Vite. A cópia é
validada antes de aceitar a restauração; se estiver ausente ou inválida, a
operação é recusada sem apagar os dados. O início normal de desenvolvimento
continua usando Vite/HMR; para voltar ao HMR após uma restauração, encerre a
instância de recuperação e execute novamente o comando de desenvolvimento.

Com o aplicativo fechado:

```sh
python3 -B scripts/reset-local-data.py         # prévia, não apaga
python3 -B scripts/reset-local-data.py --yes   # exclusão permanente
python3 -B -m unittest discover -s scripts/tests -v
```

O script remove somente os diretórios `org.racingdatastudio.app` em
`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` e `XDG_STATE_HOME` (ou seus
locais padrão no diretório do usuário). Isso inclui banco SQLite, snapshots,
modelos, preferências, cópias por evento e armazenamento do WebView.
Não limpa outros aplicativos nem altera o código-fonte. Recusa diretórios-alvo
simbólicos e execução enquanto detecta o processo nativo aberto. Não é importado
pelo frontend nem faz parte dos recursos da build; serve apenas ao desenvolvimento.
