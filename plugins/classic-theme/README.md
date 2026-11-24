# Session Desk Classic

A theme plugin for [Session Desk](../../README.md): the plain look from before Cove's pixel
art became the app's main tone. It keeps Cove's colours and changes how they are drawn.

- **Line icons** instead of pixel art (`"icons": "line"`, see
  [Themes → Icons](../../docs/plugins/THEMES.md#icons)).
- **Flat, rounded frames**: no stepped corners, raised edges, glass sheen or grain; the Control
  Center and agent cards are plain panels.
- **Neutral reading surfaces**: terminals and text sit on a neutral plate, not one tinted by the
  window's kind.
- **No pixel effects**: the theme's motion profile switches off the pixel wall and the creation,
  closing and working effects. The switches in Settings → Appearance still apply.

It comes in **Classic Dark** and **Classic Light** (Settings → Appearance).

## Install

```sh
opencove plugin install ./plugins/classic-theme
```

or from the repository: `opencove plugin install-git https://github.com/dhx/session-desk --directory plugins/classic-theme --ref <tag>`.
The server bundle carries it in `plugins/classic-theme`, and the Session Desk image installs it
from there. Classic Dark is the theme of anyone who has not chosen one; without the plugin the
app shows Cove dark.

On an OpenCove without theme icon sets the theme still applies; its icons stay pixel art.
