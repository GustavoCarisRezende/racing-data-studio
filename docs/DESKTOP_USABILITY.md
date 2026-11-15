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

O SQLite continua autoritativo. A migration 9 adiciona uma tabela separada de
nomes visuais; não recria a tabela de páginas nem regrava documentos existentes.

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
- O snapshot ativo e os referenciados por análises salvas não podem ser
  excluídos. Documentos inválidos ou referências que não possam ser verificadas
  bloqueiam a exclusão por segurança. Modelos que usam seleção latest não
  representam uma referência fixa a um snapshot antigo.
- As verificações e a exclusão de páginas e snapshot ocorrem na mesma transação
  de escrita, sob os bloqueios cooperativos usados pela sincronização.
- Renomear não altera IDs ou nomes de arquivos. Excluir não apaga cópias por
  evento já publicadas, e essas cópias não substituem o backup do banco.
- Falhas de exclusão aparecem dentro do modal; conflitos de nome são mostrados
  junto ao campo de edição, sem depender de detalhes técnicos ocultos.

## Janela e links

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

Nenhum banco real do usuário foi modificado ou teve snapshots excluídos durante
essas verificações.
