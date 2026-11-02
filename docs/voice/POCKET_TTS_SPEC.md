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
| Pronunciation | A respelling list per language before synthesis (see below), plus an optional `OPENCOVE_VOICE_DIR/lexicon.<lang>.json` | The German model reads English developer words by German rules |
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

Whole words, case-insensitive, applied only to what is synthesized; the text on screen is unchanged.

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

## What changes

### 1. Engine in the voice host

The host keeps its process, protocol, idle unload and offline rule (WEB_SPEC §1). Inside it:

- **Runtime: onnxruntime-node**, as for Whisper. The four graphs needed without cloning are `text_conditioner`, `flow_lm_main`, `flow_lm_flow` and `mimi_decoder`; the cloning-only `mimi_encoder` is not shipped. The voice state is passed to `flow_lm_main` as its initial state.
- The pipeline (tokenize → condition → flow LM steps → Mimi decode, per sentence) is ported to TypeScript. It is small; the risk is in matching the reference numerically, which the plan's first step checks.
- **Fallback if ONNX does not fit:** the host runs the reference Python package instead. That adds Python and PyTorch CPU (~700 MB) to the image, so it is the fallback, not the plan.
- Languages load on first use and unload with the host, so a German-only user never holds the English model.

### 2. Settings and API

- `voice.voice` (a Kokoro voice id) goes away. The voice is whatever the installation provides. Settings show whether a private voice is installed and fall back to a catalog voice otherwise (see risks).
- `voice.language`: `auto` (default, follow the request), `de`, `en`.
- `voice.status` reports the installed languages and whether the private voice is present.
- The `/voice/speak` body takes `language` instead of `voice`. Frames stay as they are; the sample rate is 24 kHz either way.

### 3. Packaging

- Remove `kokoro-js` (and with it `phonemizer` and the Kokoro voices, 30 MB). `@huggingface/transformers` stays for Whisper, so `sharp` stays (#29).
- The image stage (WEB_SPEC §6) downloads the open Pocket TTS weights by pinned revision and checksum, exports the ONNX graphs, and ships a `NOTICE` with the CC-BY-4.0 attribution for the weights and the licence of any catalog voice used.
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

- **ONNX parity**: the exported graphs must reproduce the reference audio; checked first, with the Python host as the fallback.
- **Memory**: 1.7 GB peak with both languages on PyTorch. The ONNX spike measures int8; lazy per-language loading bounds the rest.
- **Fallback voice without a private one**: the German catalog voice (`juergen`) has no stated source or licence and is not shipped. The fallback is a CC0 or CC-BY catalog voice whose German embedding exists in the open repo; if none does, German without a private voice reports "no German voice installed".
- **Runner variance**: real-time factor varied 0.29–0.46 between CI CPUs; the target server is measured before release.

## Verification

- Unit: respelling (whole words, case, unchanged display text), language selection, voice-dir discovery and its status, ONNX pipeline against reference outputs recorded from the Python package.
- Contract: `/voice/speak` with `language`; `voice.status` with installed languages and the private-voice flag.
- E2E (web): the stub engine path from WEB_SPEC, plus a German turn.
- Licence: the release bundle check fails if `phonemizer` or `kokoro-js` come back; the image check requires the `NOTICE`.
- Manual: German and English turns on a phone with the private voice; a turn without it.

## Plan

1. **ONNX spike** (CI, private voice as in the first spike): export the open German and English models, run them with onnxruntime int8 and fp32 using the cloned state, compare audio and measure memory and speed. Gate: fits, or fall back to the Python host.
2. TypeScript pipeline in the voice host behind the existing `VoiceEngine` port, with reference tests.
3. Swap Kokoro out: dependencies, settings, `/voice/speak` body, multilingual Whisper, reply language.
4. Respelling list and the per-installation lexicon.
5. Voice runbook (`docs/voice/INSTALL_VOICE.md`).
6. Image stage in opencove-image: open weights, ONNX export, `NOTICE`.

Steps 2–4 are one PR each; step 1 decides the shape of 2.
