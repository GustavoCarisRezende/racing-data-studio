# Visual identity

The interface uses a restrained dark palette independent of official category identities. The home screen follows the visual reference supplied in `temp/example-rds-ui`, whose gradients, colors and specific assets take precedence in the current implementation. The screen organizes the header, selection and search, category grid and footer; the catalog contains only modules actually available. The window bar is native, not the example's illustrative bar.

Initial reference palette (the example also uses additional shades):

| Use | Color |
|---|---|
| Background | `#0F1115` |
| Surfaces | `#1A1F29` |
| Borders | `#2A3140` |
| Primary text | `#F5F7FA` |
| Secondary text | `#A9B2C3` |
| Red accent | `#D7263D` |
| Hover and focus red | `#FF4D5A` |
| Optional blue | `#3A86FF` |

Maintain readable contrast, visible focus and accessible labels. Search remains visible and must work with the keyboard, with a clear empty state; the grid should adapt to different widths without inventing categories. Cards use their own icons, honest descriptions and subtle hover highlighting.
