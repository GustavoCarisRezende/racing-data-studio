# Open testing and contributions

The open beta invites the community to test the application and contribute final polish. Check [Releases](https://github.com/GustavoCarisRezende/racing-data-studio/releases) for available versions; this does not assume that installers have been published. Testing has focused on Linux; Windows and macOS still need validation.

If there is no suitable file for your system, running from source requires development tools: clone `https://github.com/GustavoCarisRezende/racing-data-studio.git` with Git, enter `racing-data-studio`, and follow the [development prerequisites and commands](DEVELOPMENT.md#prerequisites-and-commands). No account is needed to use the application; a GitHub account is needed to open an issue. The browser preview does not replace the desktop application.

## First use

For complete instructions, examples and troubleshooting, see the [user guide](USER_GUIDE.md).

1. Open the desktop application. The first-run tutorial is optional: select **Skip tutorial** to leave. To see it again, open the hamburger menu to the right of the language selector and select **How to use the system**. Change the language in the header.
2. Enter **Formula 1** and open **Manage synchronizations**. Choose a season and select **Import**; wait for completion. Internet access is required. If the catalog fails, the alternative year list does not guarantee availability at the source.
3. In **Explore events**, choose a season and event to see available results. Future events or incomplete sources may have no results.
4. In **Data Sandbox**, try filters, tables and charts. Templates save reusable configurations; CSV exports the complete table and SVG/PNG export charts. Check notices and provenance before interpreting results.
5. In **Manage snapshots**, choose an active snapshot or restore an earlier one. Restoring an earlier snapshot creates a new active copy; activating only selects an existing one. Templates use active snapshots when opened; older analyses may depend on specific snapshots. Deleting a referenced snapshot can prevent reopening an analysis.

A successful update creates and activates a new snapshot even when content is identical. Importing and updating require a network; exploring imported data is local. Points and cumulative values are exploratory, not official standings. Source data can be incomplete even when an import finishes successfully.

## Local data and reset

Snapshots remain in the same local database and are not independent external copies. On Linux the database is normally at `~/.local/share/org.racingdatastudio.app/categories/f1.sqlite` or under `$XDG_DATA_HOME/org.racingdatastudio.app`. Per-event copies are supplemental and do not restore the database.

The menu's **Restore Default Settings** option asks for confirmation and restarts the application; it permanently deletes local data, snapshots, templates and preferences in the application's areas. Canceling deletes nothing. Exports elsewhere are not deleted. For technical details and development differences, see [usability and reset](DESKTOP_USABILITY.md).

## Contribute without programming

1. Search [existing issues](https://github.com/GustavoCarisRezende/racing-data-studio/issues) to avoid duplicates; add useful information to a related issue if one exists.
2. Copy the relevant parts of the [contribution template](models/CONTRIBUTION_TEMPLATE.md).
3. Open a [new issue](https://github.com/GustavoCarisRezende/racing-data-studio/issues/new), give it a clear title and paste the information. You may suggest an appropriate label without assuming it exists.
4. Report one problem per issue when possible. Include version, system and reproducible steps; screenshots or logs help, but remove personal data, private paths and sensitive information. **Do not submit your database or personal data.**

Suggestions and fixes are welcome, but acceptance and response times are not guaranteed. Code is under [Apache-2.0](../../LICENSE); [Jolpica F1](https://github.com/jolpica/jolpica-f1) data has its own terms, including CC BY-NC-SA 4.0 and non-commercial use. Check current terms before redistributing data.
