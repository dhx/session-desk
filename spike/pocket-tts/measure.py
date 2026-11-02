"""Pocket TTS spike: speed, memory and voice-state portability on a CI x86 runner.

Not product code. Lives on spike/pocket-tts only and is deleted with the branch.

Usage: python measure.py <phase> <out_dir>
  clone    -- gated model with voice cloning: encode the private prompt, export one state per
              language, time generation, write samples.
  portable -- open model without voice cloning (no HF token): load the exported states, time
              generation, write samples. This is the path the image would ship.

Every number is printed as a GitHub annotation (::notice), the only output readable from where the
results are evaluated. Audio never goes to the log or to an unencrypted file outside out_dir.
"""

import json
import resource
import sys
import time
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import torch

from pocket_tts import TTSModel
from pocket_tts.models.model_state import export_model_state

THREADS = 2  # the voice host gets two cores next to the agents
torch.set_num_threads(THREADS)

LANGUAGES = {
    "german": [
        "Die Tests sind grün. Soll ich den Pull Request öffnen?",
        "Kurze Zusammenfassung: fünf Dateien geändert, dreiundzwanzig Zeilen gelöscht, keine Warnungen.",
        "Der Build braucht noch etwa zwölf Minuten. Ich melde mich, sobald er fertig ist.",
    ],
    "english": [
        "The tests are green. Should I open the pull request?",
        "Short summary: five files changed, twenty-three lines removed, no warnings.",
        "The build needs about twelve more minutes. I will let you know when it is done.",
    ],
}


# German respellings for English developer words, each in the same carrier sentence. The first
# variant is the original spelling, so every term can be compared against what the model does today.
LEXICON = {
    "build": ["Build", "Bild", "Bilt"],
    "pull-request": ["Pull Request", "Pull Rickwest", "Pull Riquest"],
    "merge": ["Merge", "Mörtsch", "Mördsch"],
    "commit": ["Commit", "Kommitt"],
    "deploy": ["Deploy", "Diploi"],
    "branch": ["Branch", "Bräntsch"],
    "review": ["Review", "Riwju", "Ri-wju"],
    "push": ["Push", "Pusch"],
}
CARRIER = "Der {} ist jetzt fertig."


def lexicon_samples(model: TTSModel, state, out_dir: Path) -> None:
    for term, variants in LEXICON.items():
        for index, word in enumerate(variants):
            audio = model.generate_audio(state, CARRIER.format(word)).squeeze().numpy()
            pcm = np.clip(audio, -1, 1)
            scipy.io.wavfile.write(
                out_dir / f"lexicon-{term}-{index}-{word.replace(' ', '_')}.wav",
                model.sample_rate,
                (pcm * 32767).astype(np.int16),
            )
    notice("lexicon", f"{sum(len(v) for v in LEXICON.values())} samples")


def notice(title: str, message: str) -> None:
    print(f"::notice title={title}::{message}", flush=True)


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def measure(model: TTSModel, state, sentences: list[str], out_dir: Path, tag: str) -> dict:
    results = []
    for index, text in enumerate(sentences):
        start = time.perf_counter()
        first_chunk = None
        chunks = []
        for chunk in model.generate_audio_stream(state, text):
            if first_chunk is None:
                first_chunk = time.perf_counter() - start
            chunks.append(chunk)
        elapsed = time.perf_counter() - start
        audio = torch.cat(chunks, dim=-1).squeeze().numpy()
        seconds = audio.shape[-1] / model.sample_rate
        results.append(
            {"first_chunk_s": first_chunk, "audio_s": seconds, "rtf": elapsed / seconds}
        )
        pcm = np.clip(audio, -1, 1)
        scipy.io.wavfile.write(
            out_dir / f"{tag}-{index}.wav", model.sample_rate, (pcm * 32767).astype(np.int16)
        )
    # The first sentence includes warm-up; report it and the steady state separately.
    steady = results[1:]
    summary = {
        "first_sentence_first_chunk_s": round(results[0]["first_chunk_s"], 3),
        "steady_first_chunk_s": round(float(np.mean([r["first_chunk_s"] for r in steady])), 3),
        "steady_rtf": round(float(np.mean([r["rtf"] for r in steady])), 3),
        "audio_s": round(sum(r["audio_s"] for r in results), 1),
    }
    notice(f"{tag}", json.dumps(summary))
    return summary


def main() -> None:
    phase, out_dir = sys.argv[1], Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    states_dir = Path("states")
    report = {"phase": phase, "threads": THREADS, "torch": torch.__version__}

    for language, sentences in LANGUAGES.items():
        start = time.perf_counter()
        model = TTSModel.load_model(language=language)
        load_s = time.perf_counter() - start
        notice(
            f"{phase}-{language}-load",
            json.dumps(
                {
                    "load_s": round(load_s, 2),
                    "has_voice_cloning": model.has_voice_cloning,
                    "rss_mb": round(peak_rss_mb()),
                }
            ),
        )
        state_file = states_dir / f"{language}.safetensors"
        if phase == "clone":
            if not model.has_voice_cloning:
                notice(f"{phase}-{language}", "FAILED: gated weights not available (token or terms)")
                sys.exit(1)
            start = time.perf_counter()
            state = model.get_state_for_audio_prompt(Path("prompt.wav"))
            notice(f"{phase}-{language}-encode", f"prompt encoded in {time.perf_counter() - start:.2f}s")
            states_dir.mkdir(exist_ok=True)
            export_model_state(state, state_file)
            notice(f"{phase}-{language}-state", f"{state_file.stat().st_size / 1024:.0f} KiB")
        else:
            if model.has_voice_cloning:
                notice(f"{phase}-{language}", "FAILED: expected the open model without voice cloning")
                sys.exit(1)
            state = model.get_state_for_audio_prompt(state_file)
        report[language] = measure(model, state, sentences, out_dir, f"{phase}-{language}")
        if phase == "portable" and language == "german":
            lexicon_samples(model, state, out_dir)
        del model

    report["peak_rss_mb"] = round(peak_rss_mb())
    notice(f"{phase}-peak-rss", f"{report['peak_rss_mb']} MB")
    (out_dir / f"{phase}-report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
