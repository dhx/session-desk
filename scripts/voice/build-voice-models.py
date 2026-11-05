"""Build the voice models archive that session-desk-image puts in /opt/opencove-voice/models.

    pip install -r scripts/voice/pocket-tts/requirements.txt
    python scripts/voice/build-voice-models.py OUT_DIR LABEL [--hf-cache DIR]

Writes OUT_DIR/session-desk-voice-models-LABEL.tar.gz and OUT_DIR/SHA256SUMS.txt. The archive holds
one folder, session-desk-voice-models/, laid out as the voice host expects OPENCOVE_VOICE_MODELS_DIR:

    onnx-community/whisper-base/   Whisper base, q8, at WHISPER_REVISION
    pocket-tts/german/             Pocket TTS, exported from the open weights by export.py (int8)
    pocket-tts/english/
    NOTICE                         licences and attribution
    LICENSE-Apache-2.0.txt         the licence text Whisper's Apache-2.0 asks to ship
    SHA256SUMS                     every file above

Before packing, each language's fp32 export must match the PyTorch model (reference.py
--check-pytorch --strict) with the open catalog voice "alba". No Hugging Face token is used: the
open repositories are not gated, and a token would make pocket-tts load the gated weights.
"""

import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

HERE = Path(__file__).resolve().parent
LANGUAGES = ("german", "english")
WHISPER_REPO = "onnx-community/whisper-base"
WHISPER_REVISION = "27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c"
# The configs and tokenizer (all small), and the two q8 graphs transformers.js loads for dtype q8.
WHISPER_FILES = ["*.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]
TOP = "session-desk-voice-models"

NOTICE = """Session Desk voice models

pocket-tts/german, pocket-tts/english
  Kyutai Pocket TTS ({pocket_repo}), open weights without voice cloning,
  converted to ONNX and quantized to int8 by Session Desk (scripts/voice/pocket-tts/export.py).
  Weights and tokenizer: Kyutai, CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/).
  Changes: exported to ONNX graphs, KV cache write rewritten as a scatter, weights quantized to int8.
  Revisions: {pocket_revisions}
  No voice is included; voices are installed per server (docs/voice/INSTALL_VOICE.md).

onnx-community/whisper-base
  Whisper base by OpenAI, Apache-2.0 (text in LICENSE-Apache-2.0.txt),
  in the ONNX conversion of onnx-community ({whisper_repo}@{whisper_revision}),
  copied unchanged (q8 graphs, configs and tokenizer).
"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run(*args: str, env: dict[str, str]) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, check=True, env=env)


def open_revision(bundle: dict) -> tuple[str, str]:
    """The open repo and revision bundle.json names in `weights` (hf://<repo>/<path>@<revision>)."""
    match = re.fullmatch(r"hf://([^/]+/[^/]+)/.+@([0-9a-f]{40})", bundle["weights"])
    if not match:
        sys.exit(f"bundle.json weights is not a pinned hf:// path: {bundle['weights']}")
    return match.group(1), match.group(2)


def export_language(language: str, work: Path, env: dict[str, str]) -> tuple[Path, str, str]:
    out = work / "pocket-tts" / language
    run(sys.executable, str(HERE / "pocket-tts" / "export.py"), language, str(out), "--keep-fp32", env=env)
    bundle = json.loads((out / "bundle.json").read_text())
    repo, revision = open_revision(bundle)
    voice = hf_hub_download(
        repo,
        f"languages/{language}/embeddings/alba.safetensors",
        revision=revision,
        cache_dir=env["HF_HUB_CACHE"],
    )
    run(
        sys.executable, str(HERE / "pocket-tts" / "reference.py"),
        str(out.parent / f"{language}-fp32"), voice, str(work / f"{language}.reference.json"),
        "--check-pytorch", "--strict",
        env=env,
    )
    for name, digest in bundle["files"].items():
        if sha256(out / name) != digest:
            sys.exit(f"{language}/{name} does not match bundle.json")
    return out, repo, revision


def pack(stage: Path, archive: Path) -> None:
    """A tar.gz that depends only on the files: sorted, no owners, no times."""
    def clean(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mtime = 0
        info.mode = 0o755 if info.isdir() else 0o644
        return info

    with archive.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for path in [stage, *sorted(stage.rglob("*"))]:
                tar.add(path, arcname=str(Path(TOP) / path.relative_to(stage)), recursive=False, filter=clean)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out_dir, label = Path(sys.argv[1]).resolve(), sys.argv[2]
    if not re.fullmatch(r"[0-9A-Za-z.-]+", label):
        sys.exit("LABEL may hold letters, digits, dots and dashes only")
    if os.environ.get("HF_TOKEN"):
        sys.exit("Unset HF_TOKEN: the models must come from the open repositories only.")
    env = {k: v for k, v in os.environ.items() if k != "HF_TOKEN"}
    if "--hf-cache" in sys.argv:
        env["HF_HUB_CACHE"] = sys.argv[sys.argv.index("--hf-cache") + 1]
    else:
        # An empty cache: one that holds the gated weights would be picked over the open ones.
        env["HF_HUB_CACHE"] = tempfile.mkdtemp(prefix="voice-models-hf-")
    # huggingface_hub read HF_HUB_CACHE when it was imported: its own downloads below get the cache
    # as cache_dir, the export and reference subprocesses through their environment.

    out_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="voice-models-", dir=out_dir))
    stage = work / "stage"
    revisions = []
    pocket_repo = ""
    for language in LANGUAGES:
        bundle_dir, pocket_repo, revision = export_language(language, work, env)
        shutil.copytree(bundle_dir, stage / "pocket-tts" / language)
        revisions.append(f"{language}@{revision}")

    whisper = Path(
        snapshot_download(
            WHISPER_REPO,
            revision=WHISPER_REVISION,
            allow_patterns=WHISPER_FILES,
            cache_dir=env["HF_HUB_CACHE"],
        )
    )
    target = stage / WHISPER_REPO
    for path in sorted(whisper.rglob("*")):
        if path.is_file():
            (target / path.relative_to(whisper).parent).mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target / path.relative_to(whisper))
    for needed in ("config.json", *WHISPER_FILES[1:]):
        if not (target / needed).is_file():
            sys.exit(f"Whisper download lacks {needed}")

    (stage / "NOTICE").write_text(
        NOTICE.format(
            pocket_repo=pocket_repo,
            pocket_revisions=", ".join(revisions),
            whisper_repo=WHISPER_REPO,
            whisper_revision=WHISPER_REVISION,
        )
    )
    shutil.copyfile(HERE / "licenses" / "Apache-2.0.txt", stage / "LICENSE-Apache-2.0.txt")
    files = sorted(p for p in stage.rglob("*") if p.is_file())
    (stage / "SHA256SUMS").write_text(
        "".join(f"{sha256(p)}  {p.relative_to(stage)}\n" for p in files)
    )

    archive = out_dir / f"{TOP}-{label}.tar.gz"
    pack(stage, archive)
    (out_dir / "SHA256SUMS.txt").write_text(f"{sha256(archive)}  {archive.name}\n")
    shutil.rmtree(work)
    print(archive, archive.stat().st_size, "bytes")
    print((out_dir / "SHA256SUMS.txt").read_text(), end="")


if __name__ == "__main__":
    main()
