# Racing Data Studio

O Racing Data Studio é um projeto de aplicativo desktop gratuito, open source e **local-first** para explorar e comparar dados históricos de automobilismo. A proposta é oferecer um laboratório visual no qual pessoas possam criar suas próprias análises, escolhendo temporadas, pilotos, equipes, métricas e gráficos, sem precisar programar ou escrever SQL.

O MVP será dedicado à **Fórmula 1**. A aplicação terá uma tela de seleção de categorias e uma arquitetura preparada para receber outras modalidades futuramente, sem exigir que compartilhem o mesmo modelo de dados.

## Estado do projeto

**Fase atual: em desenvolvimento.** O aplicativo desktop em `app/` oferece seleção de categoria, interface em inglês e português e importação manual F1 pela Jolpica. A tela de temporadas consulta o catálogo remoto, importa ou atualiza e mostra calendário e resultados armazenados localmente. Análises, gráficos, instaladores e o restante do MVP ainda não estão prontos.

O importador cruza ano, rodada, nome, circuito e data dos resultados com o calendário, sem exigir resultados para todas as rodadas. Antes de gravar, revalida as páginas e recusa reduções detectáveis frente ao último snapshot: rodadas ausentes e perda de ocorrências de pilotos por rodada e tipo de resultado. A gravação é transacional; snapshots anteriores não são apagados, e uma resposta idêntica não cria outro. Essas regras conservadoras podem também recusar correções legítimas da fonte; não há ainda fluxo para revisá-las.

Isso **não demonstra que os dados estão completos ou corretos**, especialmente na primeira importação: a API pode fornecer conteúdo incompleto com totais coerentes, e correções com os mesmos pilotos podem passar despercebidas. Mudanças durante a paginação também nem sempre são detectáveis. O armazenamento consiste em páginas JSON brutas, não tabelas normalizadas; a tela deriva suas consultas do último snapshot. Temporadas futuras ou em andamento podem conter apenas o calendário; a atualização é manual. Faltam política de revisão/recuperação e testes mais abrangentes.

### Uso e funcionamento offline

Na área F1, a primeira entrada abre **Gerenciar sincronizações** se não houver temporada importada; caso contrário, abre a exploração de eventos. Escolha uma temporada e um evento para visualizar seus resultados; a busca local filtra por nome do GP, circuito ou rodada. O seletor de corrida/sprint só aparece se houver resultados sprint. A ordenação usa posições numéricas, preservando os rótulos especiais e sua ordem original. Em **Gerenciar sincronizações**, selecione **Importar** ou **Atualizar**. O catálogo remoto usa `seasons.json` paginado; se falhar, a seleção usa os anos de 1950 até o ano local atual e inclui também todas as temporadas locais. Calendário e resultados já importados permanecem consultáveis sem rede. Uma atualização byte a byte idêntica não cria outro snapshot nem altera seu horário. Falhas não removem snapshots. O aplicativo cria `categories/f1-sync.lock` para impedir sincronizações simultâneas entre instâncias cooperantes e usa também bloqueio em memória. A efetividade do bloqueio entre processos depende do sistema de arquivos/OS; não há coordenação entre computadores.

As seções da F1 são apresentadas em abas; a primeira, **Sandbox de dados**, é apenas um indicador de funcionalidade ainda não implementada. As abas aceitam setas, Home e End. A lista de eventos possui rolagem própria, e as linhas de resultados podem ser percorridas pelas setas. Datas de calendário são exibidas sem conversão de fuso (`dd/MM/yyyy` em português, `yyyy/MM/dd` em inglês); os horários de snapshots são convertidos para UTC e exibidos com a mesma ordem de data do idioma.

**Gerenciar snapshots** lista versões de uma temporada no SQLite e permite restaurar uma versão inteira após confirmação. A restauração valida a origem e grava uma nova cópia numa transação, preservando a versão anterior e a versão restaurada; a data original dos dados fica separada da data da cópia. **A exclusão não está disponível.** O banco `categories/f1.sqlite` continua sendo a fonte autoritativa; a restauração altera a temporada inteira, não apenas um evento.

No Linux, o botão **Criar cópias por evento** extrai manualmente um snapshot SQLite selecionado, inclusive antigo, em `categories/f1/events/<ano>-<rodada>/snapshot-<id>.json` dentro do diretório de dados do aplicativo. Ano, rodada e ID são numéricos e validados, não nomes recebidos da API. Cada arquivo contém o calendário do evento e os fragmentos de resultados Race/Sprint obtidos desse snapshot, metadados de origem e SHA-256 do JSON do payload. Os arquivos são projeções suplementares: **não incluem necessariamente todos os metadados das páginas originais, não substituem um backup do banco e não são usados para restaurar dados**. O checksum detecta diferenças acidentais, não autentica o arquivo nem protege contra alterações acompanhadas da troca do checksum. A criação não é automática e não modifica nem remove registros SQLite.

Após validação do snapshot completo em leitura consistente, cada arquivo é escrito em staging, sincronizado, verificado e publicado por rename atômico sem sobrescrita; diretórios são abertos relativamente a descritores, sem seguir links simbólicos nos componentes gerenciados. Arquivos existentes só são aceitos se idênticos e verificados. Cada evento é publicado separadamente, não há transação única com SQLite ou entre todos os eventos: uma falha pode deixar cópias já publicadas e um staging. A repetição aproveita staging completo e idêntico; se estiver parcial ou diferente, interrompe sem sobrescrevê-lo ou apagá-lo. Inspecione e faça backup antes de qualquer intervenção manual. O mecanismo depende do suporte do sistema de arquivos ao `renameat2(RENAME_NOREPLACE)` e `fsync` de diretórios; se indisponível, falha sem usar alternativa insegura. Ele não foi projetado para resistir a processos hostis com a mesma conta modificando arquivos simultaneamente. A criação não está disponível em Windows/macOS até haver implementação equivalente. Não apague nem mova o SQLite após criar essas cópias.

O trabalho de rede e SQLite ocorre em threads de trabalho; a tela mostra a fase e o deslocamento da página, não uma porcentagem de conclusão. Para a temporada do ano local atual, a exploração pode mostrar um aviso discreto se um evento de mais de 48 horas não tem resultado ou se os dados armazenados são anteriores a ele. O aviso não consulta a rede, não promete dados disponíveis, pode ser dispensado e guarda a dispensa no armazenamento local do WebView; alterações no conjunto ou no snapshot podem gerá-lo novamente. Não há cancelamento, atualização automática ou recuperação de erro depois de sair da tela. A visualização é uma consulta simples, não é ainda o laboratório de análise. Resultados e sessões históricas são exibidos conforme a fonte; campos opcionais ausentes aparecem como traço.

- [Identidade visual e paleta](docs/IDENTIDADE_VISUAL.md) — diretrizes permanentes da interface.

## O que o MVP pretende oferecer

- Seleção de categoria, com **Fórmula 1 como única opção funcional**.
- Importação manual de temporadas pela [Jolpica F1 API](https://github.com/jolpica/jolpica-f1), incluindo calendário e resultados disponíveis de corridas e sprints.
- Consulta local de eventos e resultados e exploração por meio de tabelas e gráficos de linhas e barras.
- Comparações entre pilotos ou equipes, inclusive entre temporadas importadas, com filtros e métricas como pontos por evento e pontos acumulados.
- Salvamento e reabertura de análises, inclusive offline após a importação dos dados.
- Indicação de progresso e erros de importação, com atualização manual e sem duplicação de dados.
- Interface inicialmente disponível em inglês (Estados Unidos) e português (Brasil).

O aplicativo não exigirá conta, backend próprio ou servidor iniciado manualmente. Dados e análises ficarão no computador do usuário. Resultados de treinos e classificações, telemetria, dados ao vivo e integrações com outras categorias estão fora do MVP; metadados de sessões poderão aparecer no calendário quando disponíveis.

## Arquitetura prevista

A stack planejada é **Tauri v2**, **React**, **TypeScript**, **Vite**, **Rust** e **SQLite**. A interface desktop e o laboratório visual serão compartilhados; cada categoria será responsável por sua integração, regras, consultas, migrations e banco SQLite independente. No MVP, somente o módulo F1 e seu banco local serão implementados.

A ferramenta de exploração visual será escolhida entre **Graphic Walker** e **Perspective** após uma prova de conceito. O acesso SQLite inicial é feito em Rust via rusqlite. Nenhum banco preenchido será distribuído no repositório ou nos instaladores.

## Desenvolvimento inicial

O código-fonte fica em `app/`: `src/categories` define o contrato de apresentação e o registro estático; `src/categories/f1` contém a tela do módulo. `src-tauri/src/f1` é dono do repositório SQLite e migrations; o shell não acessa suas tabelas. Na inicialização desktop, cria-se `categories/f1.sqlite` no diretório de dados da aplicação fornecido pelo Tauri (no Linux, tipicamente `$XDG_DATA_HOME/org.racingdatastudio.app`, ou `~/.local/share/org.racingdatastudio.app`). As migrations 1 a 3 são transacionais, preservam temporadas anteriores e rejeitam versões futuras; a 3 adiciona a data de origem de cópias restauradas sem remover registros. Erros de abertura ou migração impedem a inicialização e são reportados no erro nativo, ainda sem tela de recuperação. O idioma acompanha inicialmente o sistema e pode ser alterado na interface, mas a preferência ainda não é persistida.

No Fedora, instale Node.js compatível com Vite (Node 22.12+ ou 24+), Rust/Cargo e os pré-requisitos nativos conforme a [documentação oficial do Tauri para Linux](https://v2.tauri.app/start/prerequisites/#linux). Em particular, são necessários os pacotes de desenvolvimento WebKitGTK 4.1, GTK 3 e libsoup 3. Depois:

```sh
cd app
npm ci --ignore-scripts
npm run build             # TypeScript e build web
npm test                  # datas, navegação de abas e ordenação sem rede
npm audit
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri dev         # aplicação desktop, requer Rust e bibliotecas nativas
```

`npm run dev` permite inspecionar apenas a interface no navegador; não valida a integração desktop. O empacotamento está desativado enquanto a base nativa não for validada. Não há servidor manual necessário ao executar uma futura versão desktop compilada.

### Dependências e limitações de verificação

Versões diretas incluem React/React DOM 19.3.1, Vite 8.3.6, TypeScript 7.0.2, plugin React 6.2.1, Tauri CLI e API JS 2.12.4, crate Tauri 2.12.5, tauri-build 2.7.4, rusqlite 0.41.1, reqwest 0.13.5, serde 1.0.229, serde_json 1.0.154, sha2 0.10.9 e rustix 1.1.4 (Linux). Dependências diretas estão fixadas; `app/package-lock.json` e `app/src-tauri/Cargo.lock` registram as árvores. A árvore Rust ampliada ainda precisa de revisão de procedência e auditoria de segurança. A instalação npm usada para validação desabilitou scripts de dependências; verifique procedência e mudanças nos lockfiles antes de atualizá-los. Execute também uma auditoria Rust (por exemplo, `cargo audit` instalado e verificado a partir de fonte oficial) antes de distribuir.

**Verificação atual:** Rust/Cargo 1.99.1 e GTK/WebKit disponíveis; build web e nativo, testes Rust e inicialização de desenvolvimento foram executados. A inicialização foi interrompida após teste limitado, sem validação visual completa. `cargo-audit` e `rustfmt` não estavam instalados; auditoria Rust, validação visual, empacotamento e testes em outras plataformas permanecem pendentes.

Os testes Rust normais não usam rede. Um teste opcional exclusivamente de leitura, que consulta Jolpica sem gravar temporadas, pode ser executado com `cargo test --manifest-path src-tauri/Cargo.toml --locked live_read_only_smoke -- --ignored` a partir de `app/`. Ele consome requisições reais e está excluído da suíte padrão.

Os comandos Tauri estão autorizados apenas à janela local `main` por capability explícita; nenhuma origem remota recebe acesso IPC. A CSP não libera acesso direto do WebView à Jolpica: HTTPS é feito em Rust, com URL fixa e sem redirects. Não foram adicionadas permissões de plugins de sistema de arquivos ou rede ao frontend.

O desenvolvimento e os primeiros testes e instalador priorizarão **Fedora Linux 44 com KDE**. O objetivo é oferecer suporte multiplataforma, incluindo Linux, Windows e macOS; as demais plataformas e seus instaladores ainda precisarão ser testados e validados.

## Plano de desenvolvimento

1. **Base desktop e navegação:** estruturar o aplicativo, o seletor de categorias, o registro do módulo F1 e seu banco local com migrations.
2. **Importação F1:** integrar a Jolpica, implementar paginação, normalização, persistência transacional e idempotente, progresso e tratamento de erros.
3. **Dados para análise:** disponibilizar datasets e métricas de pilotos e equipes por meio de um contrato independente do schema interno.
4. **Prova de conceito de visualização:** comparar Graphic Walker e Perspective no Tauri, escolher uma ferramenta e implementar o salvamento e a reabertura de análises.
5. **Entrega do MVP:** validar navegação, comparações, funcionamento offline e isolamento dos dados; concluir testes, créditos, documentação, empacotamento e release no GitHub.

Essas etapas são um plano inicial, não uma indicação de funcionalidades já concluídas.

## Dados, licença e marcas

Os dados são obtidos sob demanda da [Jolpica F1](https://github.com/jolpica/jolpica-f1). Conforme seus [termos](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md), consultados em 07/11/2026, os dados são CC BY-NC-SA 4.0 e o uso gratuito é não comercial; os termos podem mudar. A [documentação](https://github.com/jolpica/jolpica-f1/blob/main/docs/README.md) exige User-Agent identificado e limita páginas a 100 itens. Os [limites](https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md) não autenticados são 4 requisições por segundo e 500 por hora, sujeitos a mudança e compartilhamento por IP. O processo espaça requisições em pelo menos 300 ms e limita a 450 por hora enquanto estiver ativo, mas outras instâncias ou dispositivos compartilham o IP e esse contador não persiste após reinício. Falhas de conexão/timeout, leitura e erros 5xx são tentadas até três vezes. HTTP 429 é repetido até duas vezes apenas quando `Retry-After` é numérico e de até 10 segundos; prazos maiores são respeitados pelo processo e relatados. Se o prazo estiver ausente ou em formato de data, o processo bloqueia novas tentativas até ser reiniciado; aguarde o prazo informado pelo provedor antes disso. Não existe coordenação global entre instâncias. Revise as condições antes da distribuição. O código é disponibilizado sob a [Apache License 2.0](LICENSE).

O projeto pretende usar identidade visual própria e não é afiliado, aprovado ou endossado pela Fórmula 1. A documentação não constitui parecer jurídico.
