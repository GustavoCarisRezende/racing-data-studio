# Integração F1 da sandbox v2 — estado parcial

O adapter F1 resolve `latest` novamente a partir dos snapshots locais em cada
abertura, aceita uma lista explícita de temporadas e conserva as seleções já
resolvidas. Uma temporada solicitada e ausente gera erro. A multisseleção usa
facetas e preserva temporada na identidade da série. Pizza e dispersão usam as
métricas existentes (soma dos pontos informados e contagem de ocorrências); as
duas métricas são calculadas na mesma consulta agrupada. O resultado não representa
classificação oficial. Análises v1 continuam fixadas nas revisões originais.

O store usa tabela SQLite própria, revisão otimista e binding `latest`. Bancos
novos recebem três modelos: barras de pontos acumulados por piloto, pizza de
pontos por equipe e tabela de pontos por piloto/equipe/temporada. Exclusões não são
revertidas automaticamente. O botão de restauração insere apenas padrões ausentes,
sem sobrescrever os existentes; depois é preciso atualizar a lista no editor.
Excluir modelo não altera análises v1 nem snapshots. Há limite de 1000 modelos;
restauração falha atomicamente se faltar espaço. Modelos não armazenam dados de
snapshots; se uma temporada vinculada deixar de existir, sua abertura falha.

O perfil v3 F1 calcula pontos observados por piloto e temporada em ordem de
sessão, antes de recortar rodada e sessão. Pontos nulos propagam; eventos ausentes
não são fabricados como zero. Filtro de equipe é rejeitado em consultas acumuladas, evitando
perder pontos obtidos anteriormente em outra equipe. Outros filtros de população
podem excluir resultados. Esta soma não é classificação oficial.

Na métrica **Pontos após o evento**, `Agrupar por` alterna entre piloto e equipe.
Por equipe, cada série continua identificada também por piloto, temporada e sessão:
o valor é o acumulado daquele piloto até aquela sessão, não um total da equipe.
Trocar de equipe não reinicia a soma. Não se somam acumulados de pilotos nem se
presume continuidade entre equipes. Se um piloto tiver resultados associados a
equipes diferentes na mesma sessão, a ordem é ambígua e a consulta é recusada.
O eixo X permanece rodada. Horários ausentes/empatados e pontos nulos conservam
as mesmas regras do perfil anterior; o filtro de equipe continua bloqueado em
acumulados para não excluir pontos anteriores. Modelos antigos não são alterados;
o novo perfil tem ID próprio e é salvo somente após escolha explícita. A migration
8 apenas versiona o suporte e não reescreve documentos nem snapshots.

### Bloqueio anterior dos protocolos v1/v2

O contrato atual só permite `displayFilters` no eixo da janela. O editor move
somente o filtro desse eixo para depois da janela; filtros de sessão e equipe
continuam em `filters`, isto é, excluem ocorrências **antes** da soma. Portanto,
selecionar somente corrida não pode significar simultaneamente “mostrar corrida”
e “incluir sprint anterior” nesse contrato. Além disso, com limite de três
dimensões, não cabe distinguir rodada, sessão, piloto e temporada no mesmo
agrupamento. Agregar por rodada antes da janela não permite mostrar valores
separados para sprint e corrida daquela rodada. A alteração silenciosa da ordem de
aplicação dos filtros também quebraria o contrato genérico e análises existentes.

O SQLite guarda as páginas de calendário originais; a projeção expõe rodada e
data/hora de corrida e sprint tal como fornecidas. O perfil v3 requer data válida e
hora UTC com segundos para cada observação participante. Se faltar uma hora, um
piloto ou houver empate temporal para o mesmo piloto/temporada, retorna
`ORDER_UNAVAILABLE`, inclusive quando a observação está fora do recorte de exibição.
Isso pode impedir o uso em temporadas históricas sem horários; não existe fallback
para ordem presumida. Metadados de calendário não garantem resultados completos.

Os testes do adapter usam apenas fixtures sintéticas. Não houve teste visual Tauri,
nem validação de CSP, acessibilidade ou desempenho desta integração v3.

### Resposta da biblioteca ao bloqueio — contrato opt-in v3

A biblioteca oferece agora query v3 com `runningSumProfiles` definidos pelo provider:
grão com rodada/piloto/temporada/sessão, partição somente por piloto/temporada e
campos de recorte pós-cálculo declarados (rodada **e** sessão). Nenhuma regra F1 ou
suposição de cronologia foi inserida no núcleo. V1/v2 preservam seus comportamentos.
O teste da biblioteca que procurava dropdown de temporada foi atualizado para as
facetas com checkboxes; o cenário sintético de captura também foi adaptado.

O host fornece `AnalysisStore.modelsV3`; a migration 7 preserva integralmente os
modelos e snapshots já existentes, sem reinstalar padrões excluídos. Padrões
ausentes em bancos antigos podem ser adicionados pela restauração explícita.
A coleção v2 antiga não lista nem modifica modelos v3. A atualização
do modelo v2 para v3 só ocorre por edição e salvamento explícitos.
Interfaces, pipeline e limites: [SANDBOX_V3_ACCUMULATION.md](SANDBOX_V3_ACCUMULATION.md).

### Gestão/UI integrada — 12/11/2026

A restauração agora é uma capacidade de `SandboxHostServices`, apresentada no
mesmo gerenciador dos modelos persistidos e com atualização automática da lista.
Foi removido o botão externo duplicado de `analysis-screen.tsx`. O provider só
ganhou `measureLabel` localizado para apresentar o perfil v3 existente como a
métrica **Pontos após o evento**, sem modificar seu algoritmo ou modelos salvos.
Sem alteração de SQL/migrations nesta rodada. Referência, diagnóstico de pizza,
regressão de estado limpo e validação: [SANDBOX_UI_RECOVERY.md](SANDBOX_UI_RECOVERY.md).
