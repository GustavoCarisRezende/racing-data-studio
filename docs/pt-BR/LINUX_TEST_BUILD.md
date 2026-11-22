# Executar o AppImage no Linux x64

Abra o AppImage avulso ou extraia o `.tar.gz` para obter o mesmo aplicativo
com as instruções e licenças. A verificação de atualizações funciona nos builds
assinados que têm um canal de atualização configurado.

```sh
chmod +x RacingDataStudio.AppImage
./RacingDataStudio.AppImage
```

O AppImage avulso pode ter o nome versionado; substitua pelo nome real do arquivo.
Use uma sessão gráfica Linux x86-64. AppImage não garante compatibilidade com
todas as distribuições: o sistema ainda precisa de bibliotecas compatíveis.
Builds produzidos numa distribuição mais recente podem não abrir numa mais antiga.

Se FUSE não estiver disponível, tente executar sem montar:

```sh
./RacingDataStudio.AppImage --appimage-extract-and-run
```

Não execute como root. O aplicativo cria normalmente seus diretórios locais;
importar uma temporada exige internet. Depois, os dados importados podem ser
explorados offline. Atualizar ou testar este pacote não exige resetar o banco.

Ao relatar um problema, informe distribuição/versão, sessão gráfica, versão do
arquivo, forma de execução e erro do terminal. Não envie bancos pessoais.
SHA256SUMS detecta corrupção na transferência; não é assinatura do publicador.
