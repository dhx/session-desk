# Voice Control in the Web UI — Spec

Status: draft for approval (2026-10-26). Text to speech moves from Kokoro to Pocket TTS: see [POCKET_TTS_SPEC.md](POCKET_TTS_SPEC.md). Change size: **Large** (new context, new worker routes, new native dependency).

## Goal

Hold a button (or a key on desktop), speak a command, and a chosen boss agent runs it. When the boss finishes, a voice reads a short summary of its answer aloud. This works in the Web UI on a phone and on a desktop browser. All speech processing runs on the worker; nothing leaves the server.

This ports the voice control from [mschmidt4377-max/MaxAI `feat/agent-orchestration-cli`](https://github.com/mschmidt4377-max/MaxAI/commits/feat/agent-orchestration-cli) (Electron, Windows) to this fork's worker + Web UI. That branch's `docs/voice/SPEC.md` holds the measurements this spec builds on.

## Reference practice

- Push-to-talk follows the walkie-talkie model, as in Discord: hold to record, release to send.
- The browser captures audio and the server runs inference. This is how Home Assistant's Assist voice pipeline and Wyoming satellites do it. A phone stays light and works on any browser that has `getUserMedia`.
- Whisper does speech to text and Kokoro does text to speech. Both run on CPU via `onnxruntime-node`. MaxAI measured Whisper `base.en` q8 at 0.7 s for a 5 s clip, and Kokoro q4 at about 4× real time.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Where models run | Worker, in a child process | Phones can't run them; no CSP loosening; one model copy for every client |
| In-browser models | Not now | Needs `'wasm-unsafe-eval'` and model delivery; COOP/COEP would break website and plugin iframes. Parked as an idea on the board |
| Model delivery | Baked into the image, never downloaded at runtime | Keeps the no-phone-home rule and the egress smoke test green |
| Engine boundary | MaxAI's `VoiceEngine` port, unchanged | A paid engine (OpenAI Realtime) can plug in later without changing callers |

## Flow

```
browser: press (button or Alt+X) -> resume AudioContext, getUserMedia
  -> AudioWorklet collects f32 frames -> release -> resample to 16 kHz mono (OfflineAudioContext) -> Int16 PCM
  -> POST /voice/transcribe (raw PCM body) -> worker -> voice host (Whisper) -> { text }
browser: controlSurface session.writeNode(boss, text + SAY hint), 300 ms later "\r"   (existing /invoke)
browser: ptyEventHub state for the boss: working -> standby (existing /pty WebSocket)
  -> controlSurface session.finalMessage (Stop-hook reply, PR #10) -> pickSpokenText
  -> POST /voice/speak { text, voice } -> streamed response, one framed PCM chunk per sentence
browser: play chunks in order with WebAudio; release of a new press aborts the fetch
```

Only the two `/voice/*` routes are new. Sending to the boss, waiting for it and reading its reply all use what the Web UI already has.

## What is ported as is

These are pure code with tests, copied from MaxAI's `src/contexts/voice/`:

- `domain/`: `voiceSettings` (normalize, defaults), `voiceTurn` (the state machine), `voiceText` (`splitIntoSentences`, `pickSpokenText`, the `SAY:` hint).
- `application/`: the `VoiceEngine` port, `VoiceService` (owns load state), `voiceTurnController`.
- `presentation/renderer/`: `bossChannel`, `speechPlayer`, `useVoiceAssistant`, `VoiceIndicator`, `VoiceSection`. Their unit tests come along.
- en and zh-CN strings.

## What changes

### 1. Engine host: Node child process instead of Electron `utilityProcess`

- `voiceHostEntry` runs under `child_process.fork` with the bundled Node runtime. It talks over `process.send` and uses structured-clone serialization, so `Float32Array` crosses as is.
- `LocalVoiceEngine` forks it lazily on the first `prepare`. It **unloads after 10 minutes idle**, which frees roughly 0.5 GB of RAM.
- The host handles one request at a time, as in MaxAI. The worker queues requests: one turn per worker, and a second client gets `voice.busy`.
- transformers is set offline: `env.allowRemoteModels = false`, `env.localModelPath = $OPENCOVE_VOICE_MODELS_DIR`. If no models are present, `prepare` fails with `voice.models_missing`, and the settings page says voice isn't installed on this server.
- transformers' ESM and CJS builds are separate instances, each with its own `env`. The host sets both offline, so the rule holds whichever one kokoro-js and the bundler pick.
- The host inherits only `PATH`, `HOME`, `TMPDIR`, locale, `TZ` and thread settings from the worker. It runs third-party model code and needs none of the worker's credentials.
- kokoro-js is imported only inside the host and only once the models are known to exist (see phonemizer under Feasibility results).

### 2. Worker routes

These follow the `/files/drop` pattern: same-origin cookie or bearer auth, a custom header as the CSRF guard, and no query token.

| Route | Request | Response | Limits |
| --- | --- | --- | --- |
| `POST /voice/transcribe` | raw Int16 LE PCM, 16 kHz mono; header `x-opencove-voice: 1` | JSON `{ text }` | 60 s of audio (1.92 MB); checked against Content-Length and while streaming |
| `POST /voice/speak` | JSON `{ text, voice }` | `application/octet-stream`, chunked: per sentence a 12-byte header (`u32` sample rate, `u32` sample count, `u32` sequence) and then f32 samples | text ≤ 4 KB; client abort ends synthesis after the current sentence |
| `voice.status` / `voice.prepare` | control-surface query and command via `/invoke` | load state and progress | — |

Both routes also take `x-opencove-voice-client: <tab id>`. A tab's own requests wait their turn; while one tab is in a request, any other gets 409 `voice.busy`. A new press interrupts the reply still playing, and that reply only stops after its current sentence, so the same tab must queue rather than be turned away. The header is not a security boundary, only a courtesy between tabs.

Auth failures answer 401; an authenticated request without `x-opencove-voice: 1` answers 403. A missing model answers 503 `voice.models_missing`. Speech is written with backpressure: the next sentence is synthesized only once the socket has taken the last one.

The route file is new and registered once in the request handler. Nothing is added to `ptyStreamHub` or the WebSocket protocol.

### 3. Browser capture

- **AudioWorklet**, not `MediaStreamTrackProcessor`, which Safari and Firefox lack. The Web UI's CSP meta tag sets `script-src 'self'`, so the worklet is built as its own same-origin asset (`?worker&url`); a `blob:` module would be refused.
- Recording and playback share one `AudioContext`. On stop the recorder flushes the worklet through its port, whose messages keep their order, so the last words are kept.
- iOS needs the `AudioContext` to be created or resumed inside the press gesture. The press handler does that before anything else.
- The microphone is open only while the button is held.

### 4. Push-to-talk control

- **A floating hold-button** on touch devices, and wherever voice is enabled. It is visible only when voice is on and a boss is chosen.
- `voice.pushToTalk` keybinding, default `Alt+X`, on desktop. MaxAI's own keydown/keyup tracking comes along.
- Blur and `visibilitychange` cancel listening.

### 5. Settings

`agentSettings.voice` is stored as in MaxAI. In web mode, app settings are **one row per worker, shared by every client**, so the boss and the voice are shared too. That is fine for one person, and noted here as a known limit.

### 6. Packaging

- `onnxruntime-node`, `@huggingface/transformers`, `kokoro-js` become dependencies. `onnxruntime-node` ships prebuilt binaries rather than building with node-gyp, so the standalone script must **copy only its linux-x64 binary**, not rebuild it.
- `standalone-glibc-floor` must cover its `.node` and `libonnxruntime.so` files.
- `check-release-bundle.mjs` needs no change: transformers names `huggingface.co` in its code, but `FORBIDDEN` holds telemetry markers, not hosts. What stops a download is the offline setting, and the egress smoke test proves it once it runs with voice prepared. The feasibility step checks that transformers and kokoro-js carry no telemetry of their own.
- **Image** (separate PR in opencove-image): a build stage downloads Whisper `base.en` q8 and Kokoro q4 by pinned revision and checksum into `/opt/opencove-voice/models`, and sets `OPENCOVE_VOICE_MODELS_DIR`. That adds about 130 MB of models plus about 60 MB of onnxruntime for linux-x64.
- **Prerequisite:** the image still installs upstream's v0.4.0 release. It has to install this fork's releases before any of our changes reach the container.

## Feasibility results (2026-10-29)

Plan step 1, measured on linux-x64 with Node 22.23.4 and a `electron-builder --linux dir` pack.

- **Versions**: `@huggingface/transformers` stays on **3.8.1**, as in MaxAI. `kokoro-js` 1.2.1 depends on transformers `^3.5.1`; transformers 4.x would bring a second copy of transformers and of onnxruntime-node. All three resolve to one `onnxruntime-node` 1.21.0.
- **No install-time download**: onnxruntime-node's postinstall fetches CUDA files from nuget.org. pnpm never runs it here, because it is not in `onlyBuiltDependencies`, and the CPU binaries are in the npm package.
- **Two native files** are all ort needs: `onnxruntime_binding.node` and `libonnxruntime.so.1` (22.3 MB). The package also ships CUDA and TensorRT providers (343 MB), a versioned duplicate of the library, and macOS, Windows and arm64 builds; `build.linux.files` leaves them out.
- **glibc floor holds**: the highest needs are GLIBC 2.28, GLIBCXX 3.4.22, CXXABI 1.3.11. The floor check had two gaps this exposed: it read version *definitions* (`.gnu.version_d`) as needs, and it had no way to say that a need is met by a library the bundle ships (`VERS_1.21.0` from `libonnxruntime.so.1`). Both are fixed; the ort files are now checked.
- **sharp** comes along: transformers' Node build imports it statically. linux-x64 only, 17 MB, within the floor. The musl variant is left out.
- **Trimmed**: transformers' web builds, wasm, maps and sources (44 MB), and `onnxruntime-web` (92 MB), which the Node build never imports.
- **Footprint**: 76.5 MB for voice in the packed app (ort 22.3, kokoro voices 28, sharp 17, the rest under 4 each), before models.
- **Loads from the bundle**: after extracting the asar, plain Node loads ort and runs a model, imports transformers and kokoro-js in 150 ms, and with `allowRemoteModels = false` a model request throws without any `fetch`.
- **Telemetry**: none in transformers or kokoro-js. transformers names `huggingface.co` only as a model host.
- **phonemizer** (kokoro's espeak-ng wasm) registers a process-wide `unhandledRejection` handler that rethrows. One stray rejection ends the process, so it must only ever load in the voice host child, never in the worker.
- **Not measured**: Whisper and Kokoro timings with real models. huggingface.co was not reachable from the build sandbox; MaxAI's numbers stand until the image ships models.

## State owners and invariants

| State | Owner | Durable? |
| --- | --- | --- |
| Turn state (`idle` … `speaking`) | browser, `voiceTurnController`, per tab | no |
| Engine load state and the model process | worker, `VoiceService` | no; rebuilt on demand |
| Voice settings | app settings row (SQLite) | yes |
| Boss reply | Claude hook channel (PR #10) | no |

Invariants:

1. At most one voice host process runs per worker, and it handles one request at a time.
2. The worker never opens a network connection for voice. Models come only from the local directory.
3. The microphone is open only between press and release, or until cancel, and audio is never written to disk.

## Top risks

- **onnxruntime-node in the bundle**: the glibc floor, bundle size, and the ABI of the bundled Node 22. The feasibility spike comes first.
- **CPU contention**: inference on the same host as the agents. Whisper takes about 1 s per utterance; Kokoro is faster than real time. The host runs at a lower `nice` priority.
- **Shared settings across clients**: noted above.
- **Upstream divergence**: everything new lives in `src/contexts/voice/` and one route file; hubs are touched once each.

## Verification

- Unit: the ported domain and application tests; the route's limits and framing; offline guard (a remote model request throws).
- Contract: `voice.status` and `voice.prepare` validation; `/voice/*` auth, including cookie without header → 403 and query token → 401.
- E2E (web suite): a stub engine (`OPENCOVE_TEST_VOICE_ENGINE=stub`) and a fake microphone. Hold the button, the stub transcript reaches a stub agent, its reply streams back as chunks.
- Release: the egress smoke test runs with voice prepared once, in a container that has models.
- Manual: a phone (iOS Safari) and a desktop browser against a test deployment.

## Plan

1. **Feasibility**: `onnxruntime-node` + transformers + kokoro-js in the standalone bundle on linux-x64. Check that it loads under the bundled Node, passes the glibc floor, loads models offline, and record bundle size and timings. Stop and report if it doesn't fit.
2. Port domain, application and their tests (pure code).
3. Engine host as a child process, offline guard, idle unload, `voice.status` and `voice.prepare`.
4. `/voice/transcribe` and `/voice/speak` with limits and tests.
5. Browser: AudioWorklet capture, speech player over the stream, hold-button, keybinding, settings page, strings.
6. Packaging checks (glibc floor, release bundle check, egress smoke) and web E2E with the stub engine.
7. opencove-image PR: model stage and env. That repository's switch to our releases is a separate prerequisite.

Each step is its own commit; steps 1–4 can merge before any UI exists.
