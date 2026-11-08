# Window header links

A plugin can add a link button to the header of every terminal and agent window,
to the right of the window's own actions. The host renders the button with the
plugin's icon; the plugin only says, per window, which address it opens. A click
opens that address in the person's own browser: in the Web UI a new browser tab,
in the desktop app the system browser. Nothing is opened inside the workspace, so
the page can use the sign-ins the person already has in their browser.

```json
{
  "contributes": {
    "nodeHeader": [{ "id": "card", "title": "Open card on the board", "stateCommand": "header-state" }],
    "commands": [
      { "id": "header-state", "title": "Window links", "description": "Links per window", "target": "plugin", "menus": [] }
    ]
  }
}
```

`stateCommand` must name a declared backend command. It receives `{ projectId }`
as parameters and `{ surface: 'canvas', projectId }` as host context, and returns
the links of that project's windows:

```js
{ nodes: { '<node id>': { url: 'https://board.example/#item=card_1', title: 'Open card' } } }
```

A window without an entry shows the button disabled, with the declared title and a
note that there is no link for it yet. `title` is optional and replaces the
declared title for that window. The button does not depend on what runs in the
window: Claude Code, Codex, OpenCode or a shell all get it, and only the plugin's
answer for the node id decides whether it is enabled.

## Loading and limits

Unlike Sidebar sections, the state is polled, since it has to follow windows the
plugin learns about in the background. There is one poller per plugin
installation, button and project, shared by all window headers, while at least one
header is mounted. It asks at once when a header mounts, then every 10 seconds,
and skips ticks while the page is hidden. A changed installation revision, runtime
generation or disabled plugin discards the cached answer. A failing provider
leaves the buttons disabled and is asked again on the next tick. Keep the command
cheap: answer from state the backend already has, without a network call per poll.

- At most 4 buttons per plugin.
- At most 2000 windows and 128 KiB per answer.
- Only absolute `https:` and `http:` addresses are kept; any other entry counts as
  "no link". The host opens them with `noopener,noreferrer`.

Settings → Plugins → plugin details → **Show in → Window header** controls
visibility. It defaults on and is independent of the other entry locations.

The shape follows VS Code's `view/title` menu contributions: declared, host-rendered
icon buttons whose enablement the extension states, rather than plugin-drawn header
markup.
