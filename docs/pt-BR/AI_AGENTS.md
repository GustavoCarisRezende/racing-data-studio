# Guia para agentes de IA

[English](../en-US/AI_AGENTS.md) · [README do projeto](../../README.md)

## Comece aqui

- Examine código e testes relevantes antes de mudar comportamento. Código e contratos
  atuais são autoritativos; revisões e handoffs datados refletem seu contexto histórico,
  não necessariamente a implementação atual.
- Consulte o [índice em português](README.md), o [guia de desenvolvimento](DEVELOPMENT.md),
  o [guia de uso](USER_GUIDE.md), o [guia de testes](BETA.md) e o
  [modelo de contribuição](models/CONTRIBUTION_TEMPLATE.md).
- Não altere a documentação do comportamento nem enfraqueça testes apenas para
  passar uma mudança. Preserve identificadores, APIs, versões, caminhos e resultados históricos.

## Mapa do repositório

- `app/src/main.tsx` e arquivos de onboarding: shell, navegação, idioma e tutorial.
- `app/src/categories/f1/`: telas F1, adapter analítico, store e serviços de exportação.
- `app/src-tauri/src/f1/commands.rs`: limite IPC da F1.
- `app/src-tauri/src/f1/repository.rs`, `jolpica.rs`, `event_archive.rs`:
  persistência, cliente remoto e cópias por evento.
- `app/src-tauri/src/f1/migrations/`: evolução do schema.
- `app/src-tauri/src/{main,desktop,reset}.rs`: registro de comandos e operações desktop.
- `packages/sandbox-{contracts,core,react,echarts}/`: contratos, transformações,
  UI React e renderer independentes da categoria. O host F1 injeta serviços.
- `packages/tests/`, `app/tests/` e testes dos módulos Rust cobrem limites diferentes.
- `docs/images/` contém capturas compartilhadas com dados sintéticos.

## Invariantes de dados e protocolo

- Páginas JSON importadas são a fonte local de verdade. Queries projetam dados em
  memória; gráficos não acessam rede. A fonte pode estar incompleta.
- Preserve decimais exatos no transporte, tabela e CSV; gráficos usam aproximações.
  Ausência não é zero e os resultados não são classificação oficial.
- `latest` de modelo resolve o snapshot local ativo, não necessariamente o último
  salvo; a seleção resolvida permanece fixa durante o uso. Análises legadas `pinned`
  exigem revisões originais e transformação compatível.
- Snapshots preservam conteúdo importado. Sincronização bem-sucedida cria e ativa um
  novo snapshot mesmo com conteúdo idêntico; restaurar uma captura anterior cria
  nova cópia ativa. Ativar apenas seleciona uma captura existente.
- Versões de protocolo, documento, transformação e schema são independentes. Preserve
  os gates de compatibilidade; as migrations SQLite chegam ao schema 10 e rejeitam
  versões futuras. Não reinterprete documentos antigos silenciosamente.
- Preserve a semântica das datas e horas de eventos da fonte: não as converta como
  horários locais de metadados. Confira formatadores e testes pertinentes.
- Reset e exclusão são irreversíveis. Execute-os somente com autorização explícita;
  use diretórios XDG isolados e dados descartáveis em testes, nunca banco pessoal.
- Permissões IPC ficam em `app/src-tauri/capabilities/f1-main.json`; examine também
  validações do backend. O destino de exportação vem do seletor nativo, não de
  caminho arbitrário do frontend. Nem todo comando F1 tem o mesmo guard de janela.

## UI e validação

- Mantenha o comportamento da UI em português e inglês alinhado, inclusive variantes
  e diálogos. Confirmações normalmente têm confirmar à esquerda e cancelar à direita;
  o diálogo de opções de exportação é exceção explícita: Cancelar à esquerda, Exportar
  à direita. Seletores nativos de arquivos são serviços da plataforma; teste seus limites.
- Prefira fixtures sintéticas e evite rede real e dados de usuários em capturas/testes.
- Mantenha assertions de DOM limitadas e compare condições booleanas quando adequado,
  evitando serializar árvores DOM grandes em falhas.
- Não instale dependências automaticamente. Quando já estiverem disponíveis e houver
  autorização, use os comandos seriais com limite de memória abaixo. Execute cada um
  separadamente na raiz; os exemplos Linux exigem systemd de usuário:

```sh
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=256 timeout 15m bash -c 'cd packages && export NODE_OPTIONS=--max-old-space-size=1536 && npm run build && node --test --test-concurrency=1 tests/*.test.mjs'
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=256 timeout 15m bash -c 'cd app && NODE_OPTIONS=--max-old-space-size=1536 node --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs'
systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -p TasksMax=256 timeout 30m bash -c 'cd app && CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml --locked'
```

Para builds de desenvolvimento, execute `npm run build` em `packages/` antes de
`npm run build` em `app/`. Consulte o guia de desenvolvimento para pré-requisitos,
escopo e limitações; relate o que foi executado sem inferir validação de plataforma ou release.
