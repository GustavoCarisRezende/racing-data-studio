# Run the AppImage on Linux x64

Open the standalone AppImage or extract the `.tar.gz` to get the same
application with instructions and licenses. Update checks work on signed
builds with an update channel configured.

```sh
chmod +x RacingDataStudio.AppImage
./RacingDataStudio.AppImage
```

The standalone AppImage may have a versioned filename; substitute its actual name.
Use a graphical Linux x86-64 session. AppImage is not a guarantee of compatibility
with every distribution: the host still needs compatible system libraries.
Builds produced on a newer distribution may not run on an older one.

If FUSE is unavailable, try running without mounting:

```sh
./RacingDataStudio.AppImage --appimage-extract-and-run
```

Do not run as root. The application creates its own local directories normally;
importing a season requires internet access. Imported data can then be explored
offline. Updating or testing this package does not require resetting the database.

When reporting a problem, include the distribution/version, desktop session,
artifact version, launch method, and terminal error. Do not attach personal
databases. SHA256SUMS detects transfer corruption; it is not a publisher signature.
