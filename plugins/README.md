# Plugins of this fork

Plugins that Session Desk maintains itself and ships with its server bundle
(`session-desk-server-linux-x64.tar.gz`, folder `plugins/`). They are ordinary
plugin packages: nothing here is loaded unless it is installed.

| Folder | What it is |
| --- | --- |
| [`classic-theme`](./classic-theme/README.md) | Session Desk Classic: the plain look (line icons, flat frames, no pixel effects), dark and light |

Install one into a running worker from a checkout or from the unpacked bundle:

```sh
opencove plugin install ./plugins/classic-theme
```

Examples for plugin authors are in [`docs/plugins/examples`](../docs/plugins/examples).
