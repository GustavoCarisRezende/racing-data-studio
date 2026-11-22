# Beta aberta: testes e contribuições

A beta aberta convida a comunidade a testar o aplicativo e relatar problemas. Em [Releases](https://github.com/GustavoCarisRezende/racing-data-studio/releases), abra a pré-release da beta, quando disponível, e procure os arquivos em **Assets**.

- **Windows x64** — baixe e execute o instalador `*-setup.exe`.
- **Linux x64** — baixe o `.AppImage`, dê permissão de execução nas propriedades do arquivo ou com `chmod +x` e abra-o. O `.tar.gz` contém o mesmo AppImage e instruções de uso. Veja o [guia para Linux](LINUX_TEST_BUILD.md).

Se não houver um arquivo adequado para seu sistema, executar a partir do código exige ferramentas de desenvolvimento: clone `https://github.com/GustavoCarisRezende/racing-data-studio.git` com Git, entre na pasta `racing-data-studio` e siga os pré-requisitos e comandos de [desenvolvimento](DEVELOPMENT.md#pré-requisitos-e-comandos). Não é necessário criar conta para usar o aplicativo; uma conta GitHub é necessária para abrir uma issue. A prévia no navegador não substitui o aplicativo desktop.

## Primeiro uso

Para orientações completas, exemplos e solução de problemas, consulte o [guia de uso](USER_GUIDE.md).

1. Abra o aplicativo desktop. O tutorial inicial é opcional: use **Pular tutorial** para sair. Para revê-lo, abra o menu hambúrguer à direita do seletor de idioma e escolha **Como usar o sistema**. O idioma pode ser alterado no cabeçalho.
2. Entre em **Fórmula 1** e abra **Gerenciar sincronizações**. Escolha uma temporada e clique em **Importar**; aguarde o fim. É necessário acesso à internet. Se o catálogo falhar, a lista alternativa de anos não garante disponibilidade na fonte.
3. Em **Explorar eventos**, escolha uma temporada e um evento para consultar resultados disponíveis. Eventos futuros ou fontes incompletas podem não ter resultados.
4. Em **Sandbox de dados**, experimente filtros, tabela e gráficos. Modelos salvam configurações reutilizáveis; CSV exporta a tabela completa e SVG/PNG exportam gráficos. Confira avisos e proveniência antes de interpretar resultados.
5. Em **Gerenciar snapshots**, você pode ativar uma captura existente ou restaurar uma anterior como nova cópia ativa. Os modelos do Sandbox usam os snapshots ativos. Análises legadas podem estar vinculadas a capturas específicas. Antes de excluir uma captura, a confirmação lista as análises vinculadas que também serão excluídas se você prosseguir.

Uma atualização bem-sucedida cria e ativa um novo snapshot, mesmo com conteúdo idêntico. Importar e atualizar exigem rede; exploração dos dados já importados é local. Os pontos e acumulados são exploratórios, não classificação oficial. A fonte pode ter dados incompletos, inclusive quando a importação termina sem erro.

## Dados locais e reset

Snapshots ficam no mesmo banco local e não são cópias externas independentes. No Linux, o banco normalmente fica em `~/.local/share/org.racingdatastudio.app/categories/f1.sqlite` ou sob `$XDG_DATA_HOME/org.racingdatastudio.app`. Cópias por evento são suplementares e não restauram o banco.

Em **Gerenciar snapshots**, use **Criar Backup** para manter uma cópia externa das temporadas, dos snapshots, dos modelos e das análises da Fórmula 1 em um ZIP. **Restaurar Backup** substitui o banco local da categoria após confirmação. Guarde o ZIP fora da pasta do app e consulte os termos da fonte dos dados antes de redistribuí-lo.

A opção **Restaurar Configurações Padrão** do menu pede confirmação e reinicia o aplicativo; ela apaga permanentemente dados locais, snapshots, modelos e preferências nas áreas do aplicativo. Cancelar não apaga. Exportações em outros locais não são apagadas. Para detalhes técnicos e diferenças de desenvolvimento, veja [usabilidade e reset](DESKTOP_USABILITY.md).

## Como contribuir sem programar

1. Pesquise [issues existentes](https://github.com/GustavoCarisRezende/racing-data-studio/issues) para evitar duplicatas; acrescente informações úteis a uma issue relacionada, se houver.
2. Copie as partes pertinentes do [modelo de contribuição](models/CONTRIBUTION_TEMPLATE.md).
3. Abra uma [nova issue](https://github.com/GustavoCarisRezende/racing-data-studio/issues/new), dê um título claro e cole as informações. Pode sugerir uma etiqueta adequada, sem presumir que exista no repositório.
4. Relate um problema por issue quando possível. Informe versão, sistema e passos reproduzíveis; capturas ou logs ajudam, mas remova dados pessoais, caminhos privados e informações sensíveis. **Não envie seu banco de dados ou dados pessoais.**

Sugestões e correções são bem-vindas, mas não há garantia de aceitação nem prazo de resposta. O código está sob [Apache-2.0](../../LICENSE); dados da [Jolpica F1](https://github.com/jolpica/jolpica-f1) têm termos próprios, incluindo CC BY-NC-SA 4.0 e uso não comercial. Consulte os termos atuais antes de redistribuir dados.
