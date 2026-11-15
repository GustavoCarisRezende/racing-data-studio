# Usabilidade desktop e gerenciamento de snapshots

## Interface

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
- O snapshot ativo não pode ser excluído. A trava baseada em análises legadas
  foi removida; excluir uma versão referenciada por um registro legado pode
  impedir a reabertura desse registro.
- As verificações e a exclusão de páginas e snapshot ocorrem na mesma transação
  de escrita, sob os bloqueios cooperativos usados pela sincronização.
- Renomear não altera IDs ou nomes de arquivos. Excluir não apaga cópias por
  evento já publicadas, e essas cópias não substituem o backup do banco.
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
das análises não são convertidos. Nos diálogos, a ação de confirmação vem à
esquerda e a de cancelamento à direita.

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

## Reset local exclusivo de desenvolvimento (Linux)

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
