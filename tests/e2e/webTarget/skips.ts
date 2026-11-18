// Tests of the Electron E2E suite that the web target (OPENCOVE_E2E_TARGET=web,
// playwright.e2e-web.config.ts) does not run. Each entry names the spec file (relative to tests/e2e)
// and, optionally, a test title in it (no title = the whole file). A title may be a literal fragment
// of a templated title (e.g. one that varies by theme); it then covers every variant. Kept honest by
// tests/unit/e2e/webTargetSkips.spec.ts, which fails when a file or title no longer exists.
//
// Categories:
// - electron-only: the test drives the Electron main process, native dialogs/menus, BrowserWindow,
//   desktop restart semantics or OS integration that the Web UI does not have.
// - electron-native-input: relies on Electron's clipboard/nativeImage or native file paths for input
//   (image paste, OS file drop); the Web UI's own path is covered by a web test in tests/e2e-web-canvas.
// - desktop-only-feature: a feature the Web UI does not offer by decision (e.g. the issue report).
// - by-design: the fork's worker or Web UI refuses what the spec does on purpose (docs/dhx/RELEASES.md).
// - web-ui-gap: the Web UI lacks an API the spec uses to set up its scene; remove the entry when the
//   Web UI gains it (canvas images are being added).
// - web-ui-bug: a real difference in the Web UI that should be fixed there (listed in RELEASES.md).
// - known-failing: fails in web mode for a reason not yet sorted out.

export type WebTargetSkipCategory =
  | 'electron-only'
  | 'electron-native-input'
  | 'desktop-only-feature'
  | 'by-design'
  | 'web-ui-gap'
  | 'web-ui-bug'
  | 'known-failing'

export interface WebTargetSkip {
  file: string
  title?: string
  category: WebTargetSkipCategory
  reason: string
}

const WEBSITE_WINDOW =
  'Native website windows (Electron WebContentsView); the Web UI shows websites in iframes'
const CANVAS_IMAGE_SEED =
  'Seeds an image node through workspace.writeCanvasImage, which the Web UI does not implement yet'
const SYSTEM_OPEN =
  'Asserts system opening through stubs of the Electron main process (shell.openExternal/openPath)'
const WORKSPACE_IN_USER_DATA =
  "Puts the test workspace inside the user data directory; this fork refuses to approve folders inside the worker's own data (workspaceRootGuard, #5)"
const MAIN_IPC_STUB = 'Stubs an IPC handler of the Electron main process (ipcMain)'

export const webTargetSkips: WebTargetSkip[] = [
  // Electron main process, BrowserWindow, native windows
  {
    file: 'smoke.spec.ts',
    title: 'should have correct window properties',
    category: 'electron-only',
    reason: 'Reads app.getAppPath()/getName() of the Electron main process',
  },
  {
    file: 'workspace-canvas.far-view.spec.ts',
    title: 'zoom steps and a continuous wheel gesture do not commit window headers',
    category: 'electron-only',
    reason: `${WEBSITE_WINDOW}; the test reads the website window manager through BrowserWindow`,
  },
  {
    file: 'agent-terminal-state-restore.spec.ts',
    category: 'electron-only',
    reason: 'Drives the stub agent through ipcMain handlers of the Electron main process',
  },
  {
    file: 'app-header.fullscreen-inset.spec.ts',
    category: 'electron-only',
    reason:
      'Emits BrowserWindow full-screen events; the macOS traffic lights exist only on desktop',
  },
  {
    file: 'workspace-canvas.agent-attention-routing.spec.ts',
    category: 'electron-only',
    reason:
      "Sets the main process's foreground state and reads its system notifications; the Web UI uses the browser's",
  },
  {
    file: 'workspace-canvas.agent-island.spec.ts',
    category: 'electron-only',
    reason: "Brings the app to the front by emitting the BrowserWindow's focus event",
  },
  {
    file: 'workspace-canvas.claude-hook.spec.ts',
    title: 'launches with session-file fallback and visible degradation when hook install fails',
    category: 'known-failing',
    reason:
      "Since upstream #533 the Worker decides run state; on the web target the session-file fallback stays 'unknown' (label Working) instead of reaching Standby. Recorded on the Session Board.",
  },
  {
    file: 'workspace-canvas.pixel-spotlight.spec.ts',
    title: 'lights the pointer over finished wall tiles and disables it with ambient motion',
    category: 'electron-only',
    reason: 'Hides and shows the BrowserWindow to pause the pixel wall',
  },
  {
    file: 'workspace-canvas.root-terminal-admission.spec.ts',
    category: 'known-failing',
    reason:
      'Restarts the worker between two app launches; since upstream #523 (one worker owner per profile) the web target meets the stopping owner and the restored terminal stays gated in CI. Passes locally; recorded on the Session Board.',
  },
  {
    file: 'recovery.managed-claude-convergence.spec.ts',
    category: 'by-design',
    reason: WORKSPACE_IN_USER_DATA,
  },
  {
    file: 'recovery.managed-claude-defaults.spec.ts',
    category: 'by-design',
    reason: WORKSPACE_IN_USER_DATA,
  },
  {
    file: 'recovery.managed-claude-launch-lifecycle.spec.ts',
    category: 'by-design',
    reason: WORKSPACE_IN_USER_DATA,
  },
  {
    file: 'recovery.agent-input-after-window-reopen.spec.ts',
    category: 'electron-only',
    reason:
      'Closes the BrowserWindow and reopens it through app activate (desktop window lifecycle)',
  },
  {
    file: 'pty-host.crash-recovery.spec.ts',
    category: 'electron-only',
    reason: "Crashes the desktop pty host through a debug hook the browser runtime doesn't have",
  },
  {
    file: 'workspace-canvas.spatial-pixel.reveal.spec.ts',
    title: 'first paint and partial reveal transparent in the real compositor',
    category: 'electron-only',
    reason: "Captures frames through the BrowserWindow's webContents",
  },
  {
    file: 'workspace-canvas.website-window.spec.ts',
    category: 'electron-only',
    reason: WEBSITE_WINDOW,
  },
  {
    file: 'workspace-canvas.website-window.freeze.spec.ts',
    category: 'electron-only',
    reason: WEBSITE_WINDOW,
  },
  {
    file: 'workspace-canvas.spatial-pixel.native-reveal.spec.ts',
    category: 'electron-only',
    reason: WEBSITE_WINDOW,
  },
  { file: 'plugins.repository-details.spec.ts', category: 'electron-only', reason: MAIN_IPC_STUB },
  {
    file: 'workspace-canvas.worktree-archive.isolation.spec.ts',
    category: 'electron-only',
    reason: MAIN_IPC_STUB,
  },
  {
    file: 'workspace-canvas.collapse-motion-endpoints.spec.ts',
    title: 'dirty Document disclosure hands its title back beside the unsaved indicator',
    category: 'electron-only',
    reason: MAIN_IPC_STUB,
  },
  {
    file: 'workspace-canvas.terminal-links.spec.ts',
    category: 'electron-only',
    reason: SYSTEM_OPEN,
  },
  {
    file: 'workspace-canvas.terminal-links.binary.spec.ts',
    category: 'electron-only',
    reason: SYSTEM_OPEN,
  },
  {
    file: 'workspace-canvas.terminal-links.documents.spec.ts',
    title:
      'opens an existing local file URI directory with the system file manager without a Space',
    category: 'electron-only',
    reason: SYSTEM_OPEN,
  },
  {
    file: 'workspace-canvas.note-to-task.spec.ts',
    title: 'uses note action menu to save markdown, set color, and convert to task',
    category: 'electron-only',
    reason:
      "Expects the Markdown file in app.getPath('downloads'); the Web UI hands it to the browser as a download",
  },
  {
    file: 'settings.terminal-display-calibration.spec.ts',
    title: 'automatically refreshes a legacy reference from its Desktop anchor',
    category: 'electron-only',
    reason: 'Only the desktop renderer refreshes a reference measured on the desktop',
  },
  // The desktop app together with its Web UI or its managed worker
  {
    file: 'plugins.commands.spec.ts',
    title:
      'requires node selection for multiple windows and view selection across Desktop and Web UI',
    category: 'electron-only',
    reason: 'Needs a desktop window and a Web UI window side by side',
  },
  {
    file: 'plugins.local.spec.ts',
    title: 'loads the same installed source and backend through Worker Web UI',
    category: 'electron-only',
    reason: "Opens the desktop's Web UI address (worker.getWebUiUrl) from the desktop app",
  },
  {
    file: 'workspace-canvas.desktop-web-terminal-consistency.spec.ts',
    category: 'electron-only',
    reason: 'Needs a desktop window and a Web UI window side by side',
  },
  {
    file: 'workspace-canvas.worker-web-access-continuity.spec.ts',
    category: 'electron-only',
    reason: "Changes the desktop-managed worker's Web access settings",
  },
  // Electron-native input; the Web UI's own path has web tests (tests/e2e-web-canvas)
  {
    file: 'workspace-canvas.image-paste.spec.ts',
    category: 'electron-native-input',
    reason: "Puts an image on Electron's clipboard (nativeImage); covered by a web test",
  },
  {
    file: 'workspace-canvas.native-filesystem-drop.spec.ts',
    category: 'electron-native-input',
    reason: 'Drops native file paths, which a browser does not expose; covered by a web test',
  },
  // Desktop-only features
  {
    file: 'issue-report.spec.ts',
    category: 'desktop-only-feature',
    reason: 'The issue report dialog is desktop-only by decision',
  },
  {
    file: 'whats-new-dialog.spec.ts',
    title: 'shows the update changelog dialog after first launch',
    category: 'desktop-only-feature',
    reason: 'Release notes come from the desktop app; the Web UI has none',
  },
  {
    file: 'workspace-canvas.sidebar-workspaces.spec.ts',
    title: 'shows the open-in-file-manager action in the project context menu',
    category: 'desktop-only-feature',
    reason: 'Opening a folder in the local file manager is a desktop action',
  },
  // By design in this fork
  {
    file: 'recovery.claude-session-ownership.spec.ts',
    category: 'by-design',
    reason:
      "Keeps its workspace inside the worker's user data dir; the worker refuses to approve such a root over its API (the desktop app approves it directly)",
  },
  // Web UI gaps
  { file: 'workspace-canvas.collapse.spec.ts', category: 'web-ui-gap', reason: CANVAS_IMAGE_SEED },
  {
    file: 'workspace-canvas.collapsed-context-menu.spec.ts',
    category: 'web-ui-gap',
    reason: CANVAS_IMAGE_SEED,
  },
  {
    file: 'workspace-canvas.color-identity.spec.ts',
    category: 'web-ui-gap',
    reason: CANVAS_IMAGE_SEED,
  },
  {
    file: 'workspace-canvas.spatial-pixel.materials.spec.ts',
    title:
      'uses one readable material across every node kind and gives Spaces a real worktree identity',
    category: 'web-ui-gap',
    reason: CANVAS_IMAGE_SEED,
  },
  {
    file: 'workspace-canvas.spatial-pixel.materials.spec.ts',
    title:
      'keeps material and terminal geometry stable through half, fifth and minimum canvas zoom',
    category: 'web-ui-gap',
    reason: CANVAS_IMAGE_SEED,
  },
  {
    file: 'workspace-canvas.space-explorer.image-preview.spec.ts',
    category: 'web-ui-gap',
    reason: 'Opens an image file as an image node, which needs canvas images in the Web UI',
  },
  // Web UI bugs
  {
    file: 'workspace-canvas.terminal-paste.linux.spec.ts',
    category: 'web-ui-bug',
    reason:
      'Ctrl+Shift+V reads the clipboard asynchronously; keys typed right after it reach the terminal before the pasted text',
  },
]
