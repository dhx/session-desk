# Voice: Pocket TTS instead of Kokoro — Spec

Status: draft for approval (2026-11-02). Change size: **Large** (engine swap, new model format, new install-time asset). Builds on [WEB_SPEC.md](WEB_SPEC.md); everything there stays unless this file says otherwise.

## Why

1. **Licence.** kokoro-js turns text into phonemes with `phonemizer`, which embeds eSpeak NG (GPL-3.0) although the package says Apache-2.0. Kokoro itself is Apache-2.0; the GPL comes only with that phoneme step, and it cannot be left out of kokoro-js, which imports it at load time.
2. **German.** Kokoro speaks English only. We want German and English.

[Kyutai Pocket TTS](https://pypi.org/project/pocket-tts/) does both: weights under CC-BY-4.0, code MIT, a SentencePiece/`tokenizers` front end with no phonemizer, and a small German model (`german`, 6 layers) next to `german_24l`.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| TTS model | Pocket TTS `german` and `english`, the open weights **without voice cloning** (`kyutai/pocket-tts-without-voice-cloning`) | Not gated; CC-BY-4.0 asks only for attribution |
| Voice | A **voice state** (`.safetensors`, ~4 MB per language) computed once from a consented recording with the gated cloning model, then loaded into the open model | The spike showed the open model accepts such a state; the image never carries gated weights or anyone's voice |
| Where the voice lives | Per installation, outside the image: `OPENCOVE_VOICE_DIR` with `german.safetensors`, `english.safetensors` | The voice stays private; the image stays public |
| Speech recognition | Whisper `base` (multilingual) q8 instead of `base.en` | `base.en` cannot hear German |
| Reply language | The language Whisper detected in the request | Ask in German, hear German back |
| Pronunciation | A respelling list per language before synthesis (see below), plus an optional `OPENCOVE_VOICE_DIR/lexicon.<german|english>.json` | The German model reads English developer words by German rules |
| Not taken | Supertonic 3 (OpenRAIL-M: use restrictions that must be passed on, a duty to use the latest model), Qwen3-TTS (likely too slow on CPU), Piper/KittenTTS (eSpeak NG), the browser's `speechSynthesis` (kept as a later fallback) | |

### Built-in German respellings

Chosen by ear in the spike, carrier sentence "Der … ist jetzt fertig.":

| Written | Spoken as |
| --- | --- |
| Build | Bild |
| Merge | Mördsch |
| Commit | Kommitt |
| Deploy | Diploi |
| Push | Pusch |
| Pull Request, Branch, Review | unchanged; the German model says them well |

Whole words, case-insensitive, applied only to what is synthesized; the text on screen is unchanged. The spoken form takes the case of the first letter ("merge" → "mördsch"). Inflected forms ("Builds", "gemergt") are not matched; an installation adds them to its lexicon if it needs them.

### An installation's lexicon (step 4, 2026-11-03)

`$OPENCOVE_VOICE_DIR/lexicon.german.json` and `lexicon.english.json`, optional, next to the voices:

```json
{ "Kubernetes": "Kuberneetis", "Pull Request": "Pull Rikwest" }
```

- Written → spoken, matched like the built-in list, which it extends; for the same word the lexicon wins. Keys may be phrases: they match across any whitespace, and longer phrases are tried first.
- At most 1000 entries, each text up to 100 characters, the file up to 256 KB. A missing file is no lexicon; a broken one is reported on the voice host's stderr (the worker's issue log) and ignored, so a typo never stops replies.
- Read when the language loads; an edited lexicon applies after the host's next idle unload (10 minutes) or a restart.

## Spike results (2026-11-02)

CI runner, 4 vCPU, `torch.set_num_threads(2)`, pocket-tts 4.0.1 on PyTorch 2.15 CPU. Spike code on the `spike/pocket-tts` branch, not merged.

| | open model + cloned state (shipping path) |
| --- | --- |
| First audio | 0.09–0.15 s |
| Real-time factor | 0.29 (Intel Xeon 8573C) to 0.46 (AMD EPYC 7763) |
| Model load | 4–5.5 s per language |
| Peak memory | 1.0 GB one language, 1.7 GB with both loaded in one process |
| Voice state | 4 MB per language; encoding the prompt takes 0.5–0.7 s, once |

Quality judged by ear: the voice is recognisable in German and English; English words in German sentences needed the respelling list above.

## ONNX spike results (2026-11-03)

Machine with Hugging Face access, 4 vCPU (AMD EPYC), 2 threads, voice states cloned from the consented recording.

- **Community exports do not fit.** The published ONNX bundles (`KevinAHM/pocket-tts-onnx`, CC-BY-4.0) come from an older German model: another tokenizer and an embedding table with no row equal to the current open weights. We export our own (`scripts/voice/pocket-tts/export.py`).
- **The export is a small patch, not a rewrite.** pocket-tts writes its KV cache in place at a Python int (`complete_kv`); the exporter replaces that with a scatter at `offset + arange(n)` returning the whole cache, and the causal mask already hides unwritten slots (which must be zero, not NaN). Everything else exports with `torch.onnx.export(dynamo=True)`. `flow_lm_main` takes the cache of all layers as one tensor `[layers, 2, 1, C, heads, 64]` plus the offset and returns both; `mimi_decoder` takes and returns its convolution and attention state.
- **Parity.** The fp32 graphs reproduce PyTorch at temperature 0 for German and English: same frame count, latents within 3·10⁻⁴ relative (`reference.py --check-pytorch --strict`). The int8 graphs follow their own trajectory after a few frames, as any autoregressive model under quantization does; by ear they are equal (one "Pull" heard as odd once, not again on re-listening).
- **Open vs gated weights.** German weights are identical in both repos except the Mimi encoder (not shipped). The English language model differs slightly between the repos; voices cloned with the gated English model are used with the open one.
- **Tokenizer.** transformers.js's Unigram ignores `byte_fallback`, so digits and letters without a piece (German: `q`) became `<unk>`. The host has its own Unigram tokenizer, tested against HuggingFace `tokenizers`.

| int8, onnxruntime | German | English |
| --- | --- | --- |
| Bundle size | 125 MB | 125 MB |
| Load (Node) | 0.5 s | 0.5 s |
| First audio | 0.28 s | 0.20 s |
| Real-time factor | 0.60 | 0.55 |
| Process memory (Node, one language) | 0.8 GB | 0.75 GB |

PyTorch on the same machine: real-time factor 0.57 (German) and 0.42 (English), first audio 0.3–1.6 s. Each flow step passes the KV cache into the graph and back; keeping it in place (I/O binding) is the known next optimisation, not needed for real time.

## In the host (step 3, 2026-11-03)

- **Layout.** `$OPENCOVE_VOICE_MODELS_DIR/onnx-community/whisper-base/` (q8) and `$OPENCOVE_VOICE_MODELS_DIR/pocket-tts/<german|english>/` (the output of `export.py`); voices in `$OPENCOVE_VOICE_DIR/<german|english>.safetensors`. A language is offered when its bundle is there, and can be spoken when its voice is there too. `voice.prepare` and `voice.status` answer `{ state: 'ready', languages: [{ language, voiceInstalled }] }`; speaking a language without a voice answers `voice.voice_missing` (503) before loading anything.
- **Language detection.** transformers.js 3.8 does not detect the language: without one, multilingual Whisper is told English. The host decodes from `<|startoftranscript|>` alone, and a logits processor lets the model choose the next token only between `<|de|>` and `<|en|>` by its own scores, then forces `<|transcribe|>` and `<|notimestamps|>`. One pass, no extra cost; a separate detection pass would cost about 0.85 s more per turn on the target CPU.
- **Reply language.** `/voice/transcribe` answers `{ text, language }`. The turn picks one reply language (the heard one when the setting is `auto`, else the setting) and uses it twice: the instruction appended to the prompt asks the boss for the `SAY:` line in that language, and `/voice/speak` gets `{ text, language }`. Asking only the speech model would have the German model read an English reply.
- **Streaming.** The host passes Pocket TTS's pieces on as they are decoded (2 frames, then 8), but holds the first 0.5 s back: the first pieces are shorter than the time to generate the next, and the player would run dry. Cancel aborts generation between frames, not after a sentence.
- **Measured** (CPU above, alba voice, through the host's model code): Whisper base q8 with the steered prompt transcribes a 3 s German or English clip in 1.3–1.4 s, as the transformers pipeline with a fixed language did (1.3–1.45 s). A first reply in a language starts after 0.7 s, loading its model included; generating 3 s of speech takes 2.1–2.2 s.

## What changes

### 1. Engine in the voice host

The host keeps its process, protocol, idle unload and offline rule (WEB_SPEC §1). Inside it:

- **Runtime: onnxruntime-node**, as for Whisper. The four graphs needed without cloning are `text_conditioner`, `flow_lm_main`, `flow_lm_flow` and `mimi_decoder`; the cloning-only `mimi_encoder` is not shipped. The voice state is passed to `flow_lm_main` as its initial state.
- The pipeline (tokenize → condition → flow LM steps → Mimi decode, per sentence) is ported to TypeScript. It is small; the risk is in matching the reference numerically, which the plan's first step checks.
- The ONNX spike passed, so the Python fallback (PyTorch CPU in the image, ~700 MB) is not needed.
- Languages load on first use and unload with the host, so a German-only user never holds the English model.

### 2. Settings and API

- `voice.voice` (a Kokoro voice id) goes away. The voice is whatever the installation provides. Settings show whether a private voice is installed and fall back to a catalog voice otherwise (see risks).
- `voice.language`: `auto` (default, follow the request), `de`, `en`.
- `voice.status` reports the installed languages and whether the private voice is present.
- The `/voice/speak` body takes `language` instead of `voice`. Frames stay as they are; the sample rate is 24 kHz either way.

### 3. Packaging

- Remove `kokoro-js` (and with it `phonemizer` and the Kokoro voices, 30 MB). `@huggingface/transformers` stays for Whisper, so `sharp` stays (#29).
- The image stage (WEB_SPEC §6) runs `scripts/voice/pocket-tts/export.py` against the open weights at the revision pocket-tts 4.0.1 pins, or fetches its output from a release asset, checks the checksums in `bundle.json`, and ships a `NOTICE` with the CC-BY-4.0 attribution for the weights and the licence of any catalog voice used. The host verifies every file against `bundle.json` when it loads.
- No HF token in the image build: the open repo is not gated.

### 4. Installing a voice (runbook, new doc)

One-time, by the person whose voice it is or with their written consent:

1. Record 5–10 s of clean speech (WAV, mono); keep a separate consent recording.
2. Accept the terms of `kyutai/pocket-tts` on Hugging Face (needed for cloning only).
3. `pocket-tts export-voice` for `german` and `english` → two `.safetensors` files.
4. Put them in the installation's `OPENCOVE_VOICE_DIR` (in Coolify: a file mount). Nothing goes into git or the image.

A cloned voice must not imitate anyone without their consent (Pocket TTS terms; WEB_SPEC's privacy rules apply to the recording as personal data).

## State owners and invariants

| State | Owner | Durable? |
| --- | --- | --- |
| Voice state files | the installation (`OPENCOVE_VOICE_DIR`), read-only to the worker | yes, outside the app |
| Loaded models per language | voice host | no |
| Reply language for a turn | browser turn, from the transcribe answer | no |

Invariants, in addition to WEB_SPEC's:

1. No voice recording or voice state is part of the repository, the image or a CI artifact in clear text.
2. The image contains only weights whose licence permits redistribution with attribution, and that attribution ships with them.
3. Display text and spoken text may differ only by the respelling list.

## Top risks

- **ONNX parity**: settled by the spike; `reference.py --check-pytorch --strict` repeats it on every export.
- **Memory**: about 0.8 GB per loaded language with int8 in Node; lazy per-language loading bounds the rest.
- **Fallback voice without a private one**: the German catalog voice (`juergen`) has no stated source or licence and is not shipped. The fallback is a CC0 or CC-BY catalog voice whose German embedding exists in the open repo; if none does, German without a private voice reports "no German voice installed".
- **Short German requests heard as English.** Whisper picks the language from the sound; a short German sentence full of English developer words can come out as English, and Whisper then translates it ("Der Bild ist jetzt fertig." → "The build is now finished."). Longer sentences were heard as German in every test. The reply language setting (`de`) fixes it for a German-only user.
- **Runner variance**: real-time factor varied 0.29–0.46 between CI CPUs; the target server is measured before release.

## Verification

- Unit: respelling (whole words, case, unchanged display text), language selection, voice-dir discovery and its status, ONNX pipeline against reference outputs recorded from the Python package.
- Contract: `/voice/speak` with `language`; `voice.status` with installed languages and the private-voice flag.
- E2E (web): the stub engine path from WEB_SPEC, plus a German turn.
- Licence: the release bundle check fails if `phonemizer` or `kokoro-js` come back; the image check requires the `NOTICE`.
- Manual: German and English turns on a phone with the private voice; a turn without it.

## Plan

1. ~~**ONNX spike**~~: passed (above).
2. Export tooling and the TypeScript engine (`localEngine/pocketTts/`) with reference tests; wired into the host in step 3.
3. ~~Swap Kokoro out~~: dependencies, settings, `/voice/speak` body, multilingual Whisper, reply language (above, "In the host").
4. ~~Respelling list and the per-installation lexicon~~ (above).
5. Voice runbook (`docs/voice/INSTALL_VOICE.md`).
6. Image stage in opencove-image: open weights, ONNX export, `NOTICE`.

Steps 2–4 are one PR each; step 1 decides the shape of 2.
