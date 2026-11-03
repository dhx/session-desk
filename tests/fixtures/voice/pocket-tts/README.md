# Pocket TTS fixtures

Reference outputs for the Pocket TTS engine in `src/contexts/voice/infrastructure/localEngine/pocketTts/`.

| File | Written by |
| --- | --- |
| `<language>.tokenizer.json`, `<language>.text.json` | `scripts/voice/pocket-tts/make_text_fixtures.py` |
| `<language>.reference.json` | `scripts/voice/pocket-tts/reference.py` (int8 bundle, catalog voice `alba`, temperature 0) |
| `bundle.german.json` | `scripts/voice/pocket-tts/export.py` |

The tokenizers are part of [Kyutai Pocket TTS](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) and are licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) by Kyutai; they are copied here with whitespace removed (the repository caps files at 500 lines), otherwise unchanged.

No voice recording and no voice state is stored here.
