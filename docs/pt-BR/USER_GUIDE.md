# Guia de uso — Racing Data Studio

Este guia apresenta as funções disponíveis no aplicativo desktop. Dados da fonte podem estar incompletos. Consulte o [guia de testes e contribuições](BETA.md) para instalação e participação. A interface em navegador não substitui o aplicativo desktop para importar e analisar dados locais.

## Índice

1. [Começar e navegar](#começar-e-navegar)
2. [Importar e atualizar temporadas](#importar-e-atualizar-temporadas)
3. [Explorar eventos](#explorar-eventos)
4. [Gerenciar snapshots](#gerenciar-snapshots)
5. [Sandbox: filtros e visualizações](#sandbox-filtros-e-visualizações)
6. [Métricas e interpretação](#métricas-e-interpretação)
7. [Modelos e análises salvas](#modelos-e-análises-salvas)
8. [Exportar](#exportar)
9. [Receitas rápidas](#receitas-rápidas)
10. [Dados locais, reset e privacidade](#dados-locais-reset-e-privacidade)
11. [Problemas frequentes](#problemas-frequentes)

## Começar e navegar

1. Abra o aplicativo desktop e selecione **Fórmula 1**, a categoria funcional.
2. O tutorial inicial é opcional: acompanhe os destaques ou escolha **Pular tutorial**. Para reiniciá-lo, abra o menu de três linhas à direita do seletor de idioma e escolha **Como usar o sistema**. Se houver edições não salvas, confirme antes de reiniciar o tutorial.
3. Escolha **Português (Brasil)** ou **English (US)** no cabeçalho. A escolha atual não é mantida entre reinícios.
4. Use as abas **Sandbox de dados**, **Explorar eventos**, **Gerenciar sincronizações**, **Gerenciar snapshots** e **Fonte dos dados**. Volte à tela inicial por **Categorias**.

Na tela inicial, `Ctrl+K` ou `⌘K` foca a busca; `Esc` retira o foco. Nas abas F1, use setas, `Home` e `End`. No desktop, `F11` alterna tela cheia. O tutorial pode ser dispensado e reaberto; sua marca de conclusão fica localmente no dispositivo.

## Importar e atualizar temporadas

Em **Gerenciar sincronizações**, pesquise um ano no seletor e confirme a opção desejada. Marque **Apenas temporadas não sincronizadas** se quiser restringir a lista a anos ainda não importados; o filtro depende do carregamento dos dados locais. Clique em **Importar** ou, para um ano já salvo, **Atualizar**.

A importação requer internet e consulta calendário e resultados de corridas e sprints da Jolpica. A tela mostra andamento por etapa e posição de página, não porcentagem; aguarde a conclusão antes de iniciar outra sincronização. Em caso de erro, abra **Detalhes técnicos**. Se o catálogo remoto estiver indisponível, a lista alternativa de anos é apenas uma ajuda, não uma garantia de dados disponíveis.

Uma sincronização bem-sucedida cria e ativa um novo snapshot, mesmo se o conteúdo for igual ao anterior; nesse caso a data de origem pode permanecer igual. Uma falha preserva as capturas anteriores. Atualizações que pareçam reduzir a cobertura anterior podem ser recusadas, inclusive se a fonte fez uma correção legítima. A validação não garante que a fonte esteja completa.

A importação é manual. Temporadas em andamento ou futuras podem ter calendário sem resultados. A hora local de gravação e a data de origem exibida em UTC têm significados diferentes; datas e horários dos eventos e dos dados de análise são apresentados sem conversão de fuso pelo aplicativo.

## Explorar eventos

Em **Explorar eventos**, escolha uma temporada já importada. A lista usa o **snapshot ativo** dessa temporada. Pesquise por nome de evento, circuito ou rodada; selecione um evento para ver seus detalhes e resultados.

Quando houver resultados de sprint, alterne entre **Corrida** e **Sprint**. A tabela mostra posição, piloto, equipe, pontos e status conforme a fonte; valores ausentes aparecem como traço. Linhas podem receber foco pelas setas, `Home` e `End`. Um evento pode aparecer como **Pendente** por ser futuro ou não ter resultados locais; isso não prova se a fonte já os publicou. O aviso de possível desatualização pode ser dispensado e reaparecer quando os dados mudarem.

## Gerenciar snapshots

Um **snapshot** é uma captura local de uma temporada. A lista apresenta capturas mais novas primeiro; o indicador verde **Ativa** identifica a usada na exploração, que não precisa ser a primeira da lista.

| Ação | Resultado |
|---|---|
| **Tornar ativa** | Seleciona uma captura existente sem copiar seus dados. |
| **Renomear** | Altera somente o nome exibido, não os dados nem o ID. |
| **Restaurar** | Com confirmação, valida uma captura anterior, cria uma cópia e a torna ativa. Restaurar a já ativa pode não criar cópia. |
| **Excluir** | Com confirmação, remove permanentemente a captura não ativa e suas páginas. A ativa é protegida contra exclusão. |
| **Criar cópias por evento** | No Linux, cria arquivos suplementares a partir da captura selecionada; não restaura o banco. |

Nomes são aparados e aceitam até **80 caracteres**, sem caracteres de controle; devem ser únicos na temporada, sem diferenciar maiúsculas de minúsculas. O nome automático `Snapshot #<ID>` é reservado. Confirmar o próprio nome automático sem nome personalizado não altera os metadados.

**Antes de excluir:** análises antigas podem depender de uma captura específica. A exclusão não verifica essas referências e pode impedir que a análise seja reaberta. Uma captura no mesmo banco não é uma cópia externa independente.

## Sandbox: filtros e visualizações

O Sandbox permite explorar os resultados locais. Na área à esquerda, **Modelos** abre o gerenciamento; os filtros selecionam temporadas, pilotos, equipes, rodadas e sessões. No centro fica o resultado; no modo **Editar**, o painel à direita contém a configuração. **Visualizar** oculta a edição; volte a **Editar** para alterar campos e opções.

A interface usa superfícies escuras e controles destacados; confira os rótulos e o estado marcado das caixas, não apenas a cor. As opções disponíveis variam conforme o contexto.

### Escolher dados e filtros

- Escolha uma ou mais temporadas importadas e, se desejado, use **Comparar temporadas** para adicionar outra. As séries mantêm a identidade da temporada.
- Os filtros rápidos de pilotos, equipes, rodadas e sessões têm pesquisa e caixas de seleção. Escolha valores ou use **Todos · sem restrição** para remover a restrição daquele campo.
- Em **Filtros avançados**, escolha um campo e um operador disponível, como seleção de valores, texto, intervalo, nulo ou não nulo. Filtros diferentes são combinados por **E**; valores de uma mesma seleção, por **OU**. Adicionar outro filtro para o mesmo campo substitui o anterior.
- **Limpar** remove filtros do usuário, mas mantém a seleção principal e eventuais restrições obrigatórias da visão. Nos filtros avançados de texto de piloto/equipe, a comparação é com o ID da fonte; use os filtros rápidos para pesquisar nomes.
- A seleção de temporadas aceita até 20 valores; listas de filtros carregam opções em páginas e podem ter limites. Se uma consulta exceder o limite, refine os filtros em vez de presumir que os dados foram amostrados.

### Configurar tabela e gráficos

Escolha **Tabela**, **Linha**, **Barras**, **Pizza** ou **Dispersão** pelos controles da visualização. No painel direito, selecione os campos disponíveis de dimensão/eixo, métrica, agregação, séries, comparação e dimensões adicionais. A disponibilidade depende dos dados e da configuração; o aplicativo pode ajustar um eixo incompatível ao mudar de gráfico.

- **Tabela:** escolha, oculte e reordene colunas com arrastar, botões ou `Alt+↑`/`Alt+↓`. Os cabeçalhos permitem ordenar; a página mostra 50 linhas por vez. O resumo da tabela refaz a consulta no novo agrupamento, não soma as linhas já apresentadas.
- **Linha e barras:** usam eixo e agrupamentos compatíveis. Se houver séries demais, a tela pode omitir algumas e avisar. A legenda pode ser unificada ou separada por temporada; seus itens permitem filtrar séries.
- **Pizza:** escolha ordenação, legenda e rótulos e, se desejar, agrupe fatias pequenas em **Outros**. Precisa de valores não negativos e total positivo. **Outros** soma valores de fatias, não recalcula a média da união.
- **Dispersão:** compara duas métricas numéricas, uma em cada eixo, com agregações próprias. Valores ausentes são omitidos; cada ponto representa o agrupamento escolhido, não necessariamente uma ocorrência individual.

Em **Comportamento dos gráficos**, **Unificar Eventos** só atua quando corrida e sprint estão explicitamente selecionadas. Valores simples são recalculados das ocorrências; acumulados usam o último valor cronológico, não a soma de dois acumulados. **Unificar Legendas** muda a apresentação das séries, não os dados. Leia avisos e proveniência para saber quais capturas foram usadas.

## Métricas e interpretação

| Métrica | Como interpretar |
|---|---|
| **Pontos** | Soma, média, mínimo ou máximo dos pontos informados. Um ponto desconhecido pode tornar o agregado desconhecido. |
| **Posição de largada** | Média, mínimo ou máximo das largadas; grid zero é tratado como desconhecido. |
| **Posição final** | Média, mínimo ou máximo das posições informadas; não é classificação de campeonato. |
| **Saldo de posições** | Largada menos posição final; positivo indica ganho de posições, não número de ultrapassagens. Se faltar uma posição, o saldo é desconhecido. |
| **Voltas completadas** | Soma, média, mínimo ou máximo; zero voltas é um valor válido. |
| **Ocorrências de resultado** | Contagem de resultados incluídos na consulta, não soma de pontos. |

Posições exigem identificação da sessão no agrupamento. Os pontos são agregados com precisão decimal; gráficos usam aproximações para desenho, enquanto a tabela permite consultar valores exatos. Dados ausentes não viram automaticamente zero. Resultados e acumulados **não são classificações oficiais**: não aplicam necessariamente descartes, penalidades e regras históricas.

O acumulado simples considera a população filtrada. A métrica **Pontos após o evento** usa um perfil cronológico; filtros de rodada/sessão podem recortar a exibição sem cortar o histórico calculado. Ao agrupar por equipe, o valor continua sendo do piloto, não um total acumulado da equipe. Horários ausentes ou ambíguos podem impedir o cálculo; lacunas não são sempre preenchidas.

## Modelos e análises salvas

Abra **Modelos** à esquerda para criar uma visualização, abrir, editar ou excluir registros. Uma nova visualização começa desvinculada do modelo anterior. O lápis junto ao título permite editá-lo; alterações não salvas são sinalizadas e ações que possam descartá-las pedem confirmação.

Em **Salvar modelo**, quando há um modelo selecionado, escolha atualizá-lo ou criar outro. Sem modelo selecionado, o diálogo cria um novo diretamente, sem uma opção de escolha redundante. O diálogo permite escolher se **filtros** e **seleção de dados** serão salvos: ao desmarcar uma opção, essa parte não é restaurada a partir do modelo; ao abrir no mesmo conjunto, a seleção ou filtros atuais podem ser mantidos. O campo de nome de modelos novos tem limite de 30 caracteres. Salvar configurações não salva uma cópia dos dados.

Os modelos usam a política chamada `latest`: ao abrir, ela resolve os **snapshots ativos** no escopo escolhido, mesmo que sejam históricos. A consulta aberta mantém essa seleção; para usar uma nova seleção ativa, reabra o modelo ou a aba. **Restaurar padrões** adiciona apenas modelos padrão ausentes, sem sobrescrever os existentes. Conflitos de edição são informados em vez de sobrescritos silenciosamente; atualize e reabra a versão atual.

Análises legadas aparecem no gerenciamento e podem ser abertas ou excluídas com confirmação. Elas apontam a snapshots específicos, ao contrário de modelos; excluir as capturas necessárias pode impedir sua abertura. Excluir uma análise ou modelo é permanente.

## Exportar

A exportação exige resultado completo. Em **Tabela**, exporte um **CSV** com todas as linhas filtradas, na ordem e com as colunas visíveis, não só a página atual. Em gráficos de linha, barras, pizza ou dispersão, escolha **SVG** ou **PNG** e as opções de legenda/rótulos oferecidas.

No diálogo de opções de exportação, **Cancelar** fica à esquerda e **Exportar** à direita. Em seguida, escolha destino e nome no seletor do sistema. Cancelar o seletor não salva o arquivo; o aplicativo não sobrescreve silenciosamente um arquivo existente. Não há JPEG nem manifesto separado no fluxo atual. CSV protege textos que possam ser interpretados como fórmulas; células vazias podem representar tanto texto vazio quanto dados ausentes.

## Receitas rápidas

1. **Ver uma corrida:** importe o ano em **Gerenciar sincronizações** → abra **Explorar eventos** → escolha temporada e evento → alterne corrida/sprint se houver dados.
2. **Comparar pilotos:** no Sandbox, escolha temporada, filtre pilotos e selecione Linha ou Barras → escolha pontos e dimensão de piloto → leia avisos e confira números na tabela.
3. **Comparar duas temporadas:** importe ambas → selecione as temporadas ou use **Comparar temporadas** → escolha piloto/equipe e métrica → preserve a identificação do ano nas séries.
4. **Voltar a dados anteriores:** em **Gerenciar snapshots**, escolha uma captura e use **Tornar ativa**; reabra o modelo para resolver a seleção ativa. Para criar uma nova cópia ativa, use **Restaurar**.
5. **Reutilizar e compartilhar:** ajuste filtros e visualização → dê um título e salve um modelo → exporte CSV para números ou SVG/PNG para imagem. Confira licença e privacidade antes de compartilhar.

## Dados locais, reset e privacidade

Os dados, modelos e snapshots ficam no dispositivo; importar ou atualizar usa rede. No Linux o banco costuma estar em `~/.local/share/org.racingdatastudio.app/categories/f1.sqlite`, ou sob `$XDG_DATA_HOME/org.racingdatastudio.app`. Snapshots ficam no mesmo banco; cópias por evento são suplementares e não restauram o banco.

O menu de três linhas oferece **Restaurar Configurações Padrão** no desktop. Confirmar prepara reinício e exclusão permanente de dados locais, snapshots, modelos, preferências e armazenamento local do app; cancelar não apaga. Arquivos exportados fora das pastas do aplicativo não são removidos. O reset é nativo e não exige Python. O script `scripts/reset-local-data.py` é ferramenta separada de desenvolvimento Linux; consulte [detalhes e precauções](DESKTOP_USABILITY.md#reset-nativo-e-limpeza-de-desenvolvimento-no-linux) antes de usá-lo.

Dados Jolpica têm [termos próprios](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md), incluindo atribuição, CC BY-NC-SA 4.0 e uso não comercial. Não envie banco pessoal, credenciais ou dados sensíveis ao relatar problemas; anonimize capturas e logs.

## Problemas frequentes

### Atualizações do aplicativo

Em instalações desktop compatíveis, abra o menu do cabeçalho e escolha
**Verificar atualizações**. Você pode ativar o download automático; instalar ainda
exige **Instalar e reiniciar** e confirmação. Salve edições pendentes e finalize a
sincronização antes. Atualizações preservam dados importados e modelos salvos.
Builds locais sem assinatura e instalações MSI não se atualizam sozinhos nesta
integração inicial. Veja o [estado das releases e updater](RELEASING.md) para
ativação e limites; o AppImage de teste anterior não contém este updater.

| Situação | O que verificar |
|---|---|
| Catálogo indisponível | Verifique a conexão e tente mais tarde; anos alternativos não garantem disponibilidade. |
| Falha na sincronização | Leia **Detalhes técnicos**, aguarde e tente novamente. Capturas anteriores são preservadas; a fonte pode impor limites. |
| Sem snapshot ou sem resultados | Importe uma temporada no desktop; eventos futuros ou incompletos podem ter apenas calendário. |
| Gráfico vazio ou limite atingido | Confira métrica, datas e filtros; tente tabela ou reduza temporadas e categorias. Valores ausentes não são zeros. |
| Pizza inválida | Escolha valores não negativos com total positivo ou use tabela/barras. |
| Acumulado indisponível | A fonte pode não fornecer horários suficientes para uma ordem inequívoca; tente outra métrica. |
| Modelo em conflito ou análise não abre | Atualize a lista e reabra; uma análise antiga exige que suas capturas originais ainda existam. |
| Exportação falhou | Verifique resultado completo, tamanho, permissão de escrita e nome ainda não existente; tente novamente. |

Para contribuir, pesquise relatos existentes e use o [modelo de issue](models/CONTRIBUTION_TEMPLATE.md); instruções completas estão no [guia de testes](BETA.md#como-contribuir-sem-programar).
