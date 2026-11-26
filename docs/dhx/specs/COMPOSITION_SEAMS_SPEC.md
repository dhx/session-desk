# Spec: composition seams for the voice and plugin UI

Status: **draft**. The problem is stated; the solution is still open.

## Problem

Session Desk's voice and plugin UI reach across boundaries that `harness/architecture/rules.json` closes. The
ratchet records these findings as debt (`contextForbiddenLayer` and `layerDependency`, see the PR that recorded
them). This spec decides how they are composed instead, so the counts can drop back out of `ratchet.json`.

| Finding | Where |
| --- | --- |
| presentation-renderer → app-renderer | `voice/presentation/renderer/*` (VoiceAssistant, VoiceHoldButton, VoiceIndicator, VoiceSection, VoiceTargetPicker, useVoiceAssistant) and `plugins/presentation/renderer/PluginNodeHeaderActions.tsx`: `@app/renderer` i18n, UI primitives (IconButton, Button, Menu, Toggle, CoveSelect, ViewportMenuSurface, pixelIcons), `useAppStore`, `ptyEventHub` |
| context → other context's presentation | SettingsPanelContent → VoiceSection; VoiceSection → SettingsGroup; VoiceSection, bossChannel → workspace renderer types and agentPresentation; TerminalNode → PluginNodeHeaderActions |
| no entry for `presentation/worker` | `sessionDeskRoutes.ts` → `voice/presentation/worker/*` |
| presentation-main → infrastructure | `workspace/presentation/main-ipc/register.ts` → `canvasImageStore` (the same pattern as upstream's two existing edges there) |

## To decide

1. **Reference:** how upstream composes UI across contexts today (slots or injection from `app/renderer`, where
   shared UI primitives and i18n are allowed to live). Check `docs/architecture/ARCHITECTURE.md` and current
   upstream before choosing.
2. **Settings sections from other contexts:** the settings panel renders a voice section. Choose between a
   section registry that `app/renderer` fills and the voice UI moving to `app/renderer`.
3. **Node-header slot:** TerminalNode renders plugin header actions. Use a slot that `app/renderer` fills.
4. **Worker routes:** add an allowed entry for `presentation/worker`, or register voice routes from `app/main`.
5. **Upstream merges:** prefer seams that add files over editing upstream hubs, so the next merges stay small.

## Acceptance

- `pnpm arch:check` is green with the voice/plugin counts removed from `harness/architecture/ratchet.json`.
- Voice and plugin header behave as before. Verification is listed per step in the plan.
