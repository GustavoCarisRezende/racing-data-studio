# Releases e atualizações automáticas

## Estado da implementação

Implementado na árvore de trabalho:

- Ícones explícitos para empacotamento Linux e Windows.
- Workflow GitHub Actions manual/por tag para candidatos Linux x64
  (AppImage e tar.gz contendo o AppImage) e Windows x64 (EXE NSIS e MSI WiX).
- Verificação de versões sincronizadas e ferramenta para alterar a versão.
- Empacotamento por lista explícita, avisos legais, checksums e preparação
  de manifesto de atualização.
- Testes unitários de versionamento, empacotamento e preparação do manifesto.
- Updater Tauri nativo com endpoint fixo beta/stable, verificação de versão
  assinada, download HTTPS com limite, progresso e instalação/reinício explícitos.
- Diálogo PT-BR/en-US, ação no menu, consultas em segundo plano e download
  automático opcional. Edições pendentes bloqueiam a instalação; o gate nativo
  e a trava de arquivo impedem disputa com sincronização/reset.
- Workflows de rascunho de release assinado e promoção de canal separados.

**A ativação em produção ainda exige chave pública e secrets do mantenedor.**
Sem chave pública, builds locais não consultam a rede para atualizações.
Builds de debug, executáveis Linux avulsos, plataformas não x64 e instalações MSI
não se atualizam sozinhos nesta integração inicial. Os alvos são AppImage e
Windows NSIS; MSI continua sendo instalador manual para evitar migração MSI→EXE
sem validação. Builds Windows, workflows GitHub e instalação real entre versões
assinadas ainda precisam de validação nos sistemas-alvo antes da distribuição pública.

## Build local de teste Linux

Veja as [instruções de teste Linux](LINUX_TEST_BUILD.md). O primeiro arquivo local
foi compilado como `0.1.0`, antes da adoção da numeração pública.
Não é uma release e não se atualiza automaticamente. Builds locais usam a base de
bibliotecas do sistema de compilação; o candidato Linux do CI usa Ubuntu 22.04.

Na raiz do repositório, após instalar os pré-requisitos de
[desenvolvimento](DEVELOPMENT.md):

```sh
cd packages
npm run build
npm run notices --silent > ../release-notices.txt
cd ../app
npm run tauri build -- --bundles appimage --config '{"bundle":{"active":true}}' -- --locked
cd ..
python3 -B scripts/collect-candidate.py --platform linux-x64
```

Aplique os limites de recursos do guia de desenvolvimento às compilações nativas.
`artifacts/` deve estar vazia: o coletor recusa misturar candidatos antigos e novos.
Mova um candidato anterior para outro local, sem apagar arquivos desconhecidos.
O coletor inclui somente caminhos explícitos dos arquivos, avisos, instruções e
LICENSE; nunca compacta o repositório nem diretórios de dados do aplicativo.
Os avisos gerados cobrem atualmente os pacotes JavaScript, não um inventário
completo das dependências nativas. Concluir a revisão de licenças Rust/bibliotecas
do sistema empacotadas e o SBOM antes da distribuição pública.

## Versionamento

Nome público: **Racing Data Studio 0.0.1 Beta**.
Versão técnica/tag: `0.0.1-beta.1` / `v0.0.1-beta.1`.
Depois, `beta.2`, `beta.3` etc., seguido de `0.0.1` para a versão estável.

```sh
python3 -B scripts/release.py version 0.0.1-beta.1
python3 -B scripts/release.py check --version 0.0.1-beta.1
python3 -B -m unittest discover -s scripts/tests -v
```

A ferramenta altera somente o pacote da aplicação, a raiz do lock npm, a
configuração Tauri, o manifesto Cargo e a entrada da aplicação no lock Cargo.
Versões dos pacotes independentes não mudam. O workflow confere a correspondência
entre tag e versões da aplicação. Criar/enviar uma tag é uma ação explícita do
processo de publicação; as instruções não fazem isso automaticamente.

`0.0.1-beta.1` é inferior à versão antiga de desenvolvimento `0.1.0`; instalações
de desenvolvimento existentes não a descobrem pelo comparador normal de upgrade.
O Windows Installer tem restrições de versão numérica; validar separadamente a
identidade e o versionamento dos upgrades MSI entre betas. EXE é o alvo principal
planejado para o updater Windows, não uma migração MSI→EXE sem testes.
O UpgradeCode WiX foi fixado no valor informado por `tauri inspect wix-upgrade-code`;
NSIS instala por usuário. Escolha um formato de instalador; não instale os dois
como se fossem uma única instalação gerenciada.

## Configuração do mantenedor: assinatura

1. O mantenedor gera uma chave de assinatura Tauri fora do repositório:
   `npm run tauri signer generate -- -w <local-privado>/rds-updater.key`
   a partir de `app/`. Não colar chaves privadas em issues, conversas ou código.
2. Guardar chave privada/senha nos secrets GitHub Actions
   `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   O secret da chave privada recebe o conteúdo completo do arquivo, não um caminho local.
   Guardar o conteúdo da chave pública na variável de repositório
   `TAURI_UPDATER_PUBLIC_KEY`. O overlay do build assinado incorpora essa chave.
   Perder a chave privada
   pode impedir upgrades das instalações que confiam na chave pública anterior.
3. `prepare-updater.py` valida o formato da chave pública e gera
   `tauri.release.generated.json`, sem gravar a chave privada. O workflow assinado
   ativa `bundle.createUpdaterArtifacts` e `requireSignedVersion`.
   As assinaturas não substituem assinatura Authenticode do
   Windows nem garantem reputação no SmartScreen.
4. Configurar revisores obrigatórios nos ambientes GitHub `release-signing`, `release` e
   `update-channel`. Declarar esses nomes no YAML não impõe aprovação por si só.
   Restringir alterações de workflows/tags e acesso aos secrets aos mantenedores.

Nenhum workflow gera chaves. Candidatos sem assinatura não ficam prontos para o
updater. Chaves privadas nunca devem ser commitadas nem enviadas ao aplicativo.

## Publicação e promoção do canal

Usar GitHub Releases públicas para URLs imutáveis e específicas por versão:

```text
https://github.com/GustavoCarisRezende/racing-data-studio/releases/download/v0.0.1-beta.1/<arquivo>
```

Manter manifestos estáticos separados numa branch dedicada `updates`:

```text
https://raw.githubusercontent.com/GustavoCarisRezende/racing-data-studio/updates/beta.json
https://raw.githubusercontent.com/GustavoCarisRezende/racing-data-studio/updates/stable.json
```

A branch remota e os manifestos **não** foram criados por esta implementação.
Criar a branch dedicada `updates` antes da promoção, sem secrets e somente com
metadados públicos dos canais (um README inicial basta). Não usar `releases/latest`
para descobrir betas: esse endpoint exclui pre-releases.
Não incluir token GitHub no aplicativo distribuído publicamente.

1. Commitar o código revisado e enviar uma tag existente que corresponda a todos
   os manifestos da aplicação. Não criar tag de uma árvore com mudanças sem commit.
2. Executar **Prepare signed release draft**, selecionando essa tag. O workflow
   compila as plataformas, confere checksums, assina arquivos e cria um rascunho.
   Recusa sobrescrever uma release existente. Revisar rascunho e notas.
3. Testar instalação/atualização e publicar explicitamente o rascunho como
   pre-release para beta (o workflow nunca publica automaticamente).
4. Executar **Promote published release to update channel** a partir da referência
   da versão correspondente, escolhendo tag/canal. Baixa os arquivos publicados,
   confere metadados, verifica assinaturas com minisign e a chave confiável, confere
   a versão assinada, recusa versões não crescentes e envia somente o JSON completo.
   Promoções são serializadas. Uma versão estável também pode entrar em `beta`
   para os testadores migrarem; uma beta nunca entra em `stable`.

Para preparar o manifesto localmente, com `minisign` instalado e a variável
`TAURI_UPDATER_PUBLIC_KEY` definida:

```sh
python3 -B scripts/update-feed.py --version 0.0.1-beta.1 --channel beta \
  --assets downloaded-release-assets --release-json published-release.json \
  --previous previous-beta.json --output beta.candidate.json
```

`published-release.json` é a resposta da API GitHub para a release, não uma
declaração manual de publicação. O helper exige AppImage Linux e EXE Windows,
assinaturas, URLs exatas publicadas, tamanhos correspondentes e estado de upload.
A CLI exige verificação criptográfica, inclusive da versão assinada, antes de
gravar o manifesto. O helper não envia/promove manifestos; somente o workflow
separado e aprovado realiza essa etapa.

## Comportamento no aplicativo

A camada nativa fixa endpoints, chave pública, alvo e URLs de download. O IPC do
frontend não escolhe URLs arbitrárias nem pula verificação; o IPC do plugin não
recebe permissões. Download e instalação verificam assinaturas com
`requireSignedVersion`, impedindo apresentar um arquivo antigo assinado como versão nova.

Consultas começam cinco segundos após abrir e se repetem a cada seis horas;
requisições manuais também respeitam um intervalo nativo de 60 segundos. Consultas
têm timeout de 15 segundos. Downloads usam HTTPS (inclusive redirecionamentos),
timeout de 180 segundos e teto de 512 MiB mesmo sem Content-Length. O arquivo fica
em memória e não é recuperado após reiniciar. Falha de verificação nunca habilita instalação.

O download automático começa desativado e a preferência é salva localmente.
A instalação nunca é automática: abra o diálogo, salve edições pendentes, escolha
**Instalar e reiniciar** e confirme. Windows encerra ao chamar o instalador;
Linux substitui o AppImage gravável e reinicia. Importações, modelos e preferências
não são resetados. Linux exige permissão de escrita no local do AppImage.
Falhas de rede não bloqueiam o uso local nem abrem diálogos espontâneos.

## Validação de instalação e atualização

O workflow **Check desktop changes** roda a compilação do frontend e as suítes
JavaScript, Rust e Python em pull requests no Linux e no Windows. O workflow de
candidatos usa a mesma ação de validação antes de empacotar os instaladores.

No Linux x64, este teste usa dois AppImages de versões crescentes com a mesma
chave de teste. Ele valida a rejeição de uma versão anunciada incorreta,
substitui uma cópia descartável do AppImage pelo updater Tauri e reabre o SQLite
para verificar os snapshots e modelos.

```sh
RDS_SMOKE_CURRENT_APPIMAGE=/caminho/versao-anterior.AppImage \
RDS_SMOKE_NEXT_APPIMAGE=/caminho/versao-nova.AppImage \
RDS_SMOKE_CURRENT_VERSION=0.0.1-beta.1 \
RDS_SMOKE_NEXT_VERSION=0.0.1-beta.2 \
RDS_SMOKE_UPDATER_KEY=/caminho/chave-de-teste.pub \
cargo test --manifest-path app/src-tauri/Cargo.toml --locked \
  updates::tests::installs_signed_appimage_without_changing_local_data -- --ignored --exact
```

Para validar a interface, a rede e o reinício, use máquinas virtuais descartáveis
com AppImage e NSIS. Use builds assinados de um repositório de homologação com
URLs de atualização próprias. Na versão anterior, crie dados e um modelo de
teste, anote o snapshot ativo e exporte um backup. Execute **Verificar
atualizações** e **Instalar e reiniciar**. Confira a nova versão, o modelo,
o snapshot ativo e o resultado da consulta após reabrir. No Windows, teste
também o MSI fora do fluxo automático. Registre versões e plataformas testadas.

## Critérios de liberação

- [ ] Validar instalação limpa e atualização entre duas versões descartáveis assinadas.
- [ ] Testar assinatura inválida, falta de rede, download interrompido e local sem escrita.
- [ ] Testar AppImage Linux (inclusive extraído do tar.gz), EXE→EXE e comportamento MSI.
- [ ] Preservar importações, modelos, preferências e comportamento das migrations.
- [ ] Confirmar isolamento beta/stable e ausência de downgrade automático.
- [ ] Revisar licenças nativas, avisos, SBOM e situação da assinatura Windows.
- [ ] Exigir aprovação explícita do mantenedor antes de publicar release/canal.

Veja a [documentação oficial do updater Tauri](https://v2.tauri.app/plugin/updater/).
