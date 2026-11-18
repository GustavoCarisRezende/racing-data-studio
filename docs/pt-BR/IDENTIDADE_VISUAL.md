# Identidade visual

## Ícone da aplicação

A janela nativa e os pacotes usam a marca RDS de
[`app/src/assets/rds-logo.svg`](../../app/src/assets/rds-logo.svg), rasterizada em
uma área quadrada transparente. `app/src-tauri/icons/` contém PNGs de 512, 256 e
128 pixels e um ICO Windows com múltiplas resoluções. O ícone genérico provisório
de 32px deixou de ser usado.

Para regenerar a partir de `app/`:

```sh
npm run tauri icon -- src/assets/rds-logo.svg --fit contain --output /tmp/opencode/rds-branded-icons
```

Copie somente `icon.png`, `128x128.png`, `128x128@2x.png` e `icon.ico` para
`app/src-tauri/icons/` e recompile os pacotes. O AppImage contém entrada desktop,
ícone e `.DirIcon`; a miniatura no gerenciador de arquivos ou o lançador no
menu/dock também dependem da integração com o ambiente desktop. Nem todo
gerenciador de arquivos Linux mostra o ícone embutido sem essa integração.

## Interface

A interface usa uma paleta escura, sóbria e independente das identidades oficiais das categorias. A tela inicial segue a referência visual fornecida em `temp/example-rds-ui`, cujos gradientes, tons e assets específicos prevalecem na implementação atual. A tela organiza cabeçalho, seleção e busca, grade de categorias e rodapé; o catálogo contém somente módulos efetivamente disponíveis. A barra de janela é nativa, não a barra ilustrativa do exemplo.

Paleta inicial de referência (o exemplo também utiliza tonalidades adicionais):

| Uso | Cor |
|---|---|
| Fundo | `#0F1115` |
| Superfícies | `#1A1F29` |
| Bordas | `#2A3140` |
| Texto principal | `#F5F7FA` |
| Texto secundário | `#A9B2C3` |
| Destaque vermelho | `#D7263D` |
| Vermelho de hover e foco | `#FF4D5A` |
| Azul opcional | `#3A86FF` |

Manter contraste legível, foco visível e rótulos acessíveis. A busca permanece visível e deve funcionar por teclado, com estado vazio claro; a grade deve se adaptar a diferentes larguras sem inventar categorias. Os cartões usam ícones próprios, descrição honesta e destaque discreto no hover.
