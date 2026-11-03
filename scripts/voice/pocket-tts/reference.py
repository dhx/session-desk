"""Reference run of an exported Pocket TTS bundle, and its check against PyTorch.

    python scripts/voice/pocket-tts/reference.py BUNDLE_DIR VOICE.safetensors OUT.json [--check-pytorch [--strict]]

Runs the bundle with onnxruntime at temperature 0 (deterministic) on fixed sentences and writes
the token ids and every latent frame to OUT.json; the TypeScript engine's test compares against
it. With --check-pytorch it also generates the same sentences with the pocket-tts PyTorch model
(open weights, same voice). Run it on the fp32 bundle (export.py --keep-fp32): there the latents
must match closely, which proves the export. int8 graphs follow their own trajectory once a
rounding error tips a frame, as any autoregressive model does, so for them it only reports.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from safetensors.numpy import load_file
from tokenizers import Tokenizer

from pocket_tts.models.text_chunking import prepare_text_prompt

SENTENCES = {
    "german": ["Der Bild ist jetzt fertig.", "Soll ich den Pull Request mördschen?"],
    "english": ["The build is done.", "Should I merge the pull request?"],
}


class Bundle:
    def __init__(self, path: Path):
        self.dir = path
        self.b = json.loads((path / "bundle.json").read_text())
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        load = lambda n: ort.InferenceSession(str(path / f"{n}.onnx"), opts, providers=["CPUExecutionProvider"])
        self.tc, self.main, self.flow, self.mimi = map(load, ("text_conditioner", "flow_lm_main", "flow_lm_flow", "mimi_decoder"))
        self.tok = Tokenizer.from_file(str(path / "tokenizer.json"))

    def voice(self, path: str):
        t = load_file(path)
        mods = self.b["flowStateModules"]
        length = int(t[f"{mods[0]}/offset"].reshape(-1)[0])
        return np.stack([t[f"{m}/cache"][:, :, :length] for m in mods]).astype(np.float32), length

    def prompt(self, sentence: str):
        t = self.b["text"]
        return prepare_text_prompt(
            sentence, t["padWithSpacesForShortInputs"], t["removeSemicolons"],
            t["appendTerminalPunctuation"], t["capitalizeFirstLetter"], t["replaceCharacters"],
        )

    def latents(self, voice, sentence: str):
        b = self.b
        vkv, vlen = voice
        text, guess = self.prompt(sentence)
        ids = self.tok.encode(text).ids
        after = b["framesAfterEos"] if b["framesAfterEos"] is not None else guess + 2
        max_frames = math.ceil((len(ids) / b["tokensPerSecondEstimate"] + b["genSecondsPadding"]) * b["frameRate"])
        cap = vlen + len(ids) + max_frames + 1
        kv = np.zeros((b["flowLayers"], 2, 1, cap, b["kvHeads"], b["headDim"]), np.float32)
        kv[:, :, :, :vlen] = vkv
        off = np.array([vlen], np.int64)
        emb = self.tc.run(None, {"token_ids": np.array([ids], np.int64)})[0]
        _, _, kv, off = self.main.run(None, {"sequence": np.zeros((1, 0, b["latentDim"]), np.float32), "text_embeddings": emb, "kv": kv, "offset": off})
        empty = np.zeros((1, 0, b["modelDim"]), np.float32)
        x_in = np.full((1, 1, b["latentDim"]), np.nan, np.float32)
        out, eos_step, n = [], None, b["samplerDecodeSteps"]
        for step in range(max_frames):
            c, eos, kv, off = self.main.run(None, {"sequence": x_in, "text_embeddings": empty, "kv": kv, "offset": off})
            if eos[0, 0] > b["eosThreshold"] and eos_step is None and step >= b["minFramesBeforeEos"]:
                eos_step = step
            if eos_step is not None and step >= eos_step + after:
                break
            x = np.zeros((1, b["latentDim"]), np.float32)
            for i in range(n):
                s, t = np.full((1, 1), i / n, np.float32), np.full((1, 1), (i + 1) / n, np.float32)
                x = x + self.flow.run(None, {"c": c, "s": s, "t": t, "x": x})[0] / n
            out.append(x.reshape(-1))
            x_in = x.reshape(1, 1, -1)
        return ids, np.stack(out)


def pytorch_latents(language: str, voice_path: str, sentence: str) -> np.ndarray:
    import torch

    from pocket_tts import TTSModel

    torch.set_grad_enabled(False)
    model = TTSModel.load_model(language=language, temp=0.0)
    assert not model.has_voice_cloning, "compare against the open weights (unset HF_TOKEN, empty cache)"
    state = model.get_state_for_audio_prompt(voice_path)
    frames = []
    original = model._run_flow_lm_and_increment_step

    def capture(**kwargs):
        result = original(**kwargs)
        if kwargs.get("backbone_input_latents") is not None:
            frames.append(result[0].numpy().reshape(-1).copy())
        return result

    model._run_flow_lm_and_increment_step = capture
    model.generate_audio(state, sentence)
    # The reference also runs the step on which it stops; that latent is never emitted.
    return np.stack(frames[:-1])


def main() -> None:
    bundle_dir, voice_path, out_path = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    bundle = Bundle(bundle_dir)
    voice = bundle.voice(voice_path)
    language = bundle.b["language"]
    cases = []
    for sentence in SENTENCES[language]:
        ids, lat = bundle.latents(voice, sentence)
        case = {"sentence": sentence, "ids": ids, "latents": np.round(lat, 6).tolist()}
        if "--check-pytorch" in sys.argv:
            ref = pytorch_latents(language, voice_path, sentence)
            n = min(len(ref), len(lat))
            drift = float(np.abs(ref[:n] - lat[:n]).max() / (np.abs(ref).mean() + 1e-9))
            case["pytorch"] = {"frames": len(ref), "relativeDrift": round(drift, 4)}
            print(sentence, "frames onnx", len(lat), "pytorch", len(ref), "relative drift", round(drift, 4))
            if "--strict" in sys.argv and (len(ref) != len(lat) or drift > 1e-3):
                sys.exit(f"fp32 bundle does not match PyTorch for {sentence!r}")
        cases.append(case)
    fixture = {"language": language, "bundle": bundle.b["files"], "cases": cases}
    out_path.write_text(json.dumps(fixture) + "\n")


if __name__ == "__main__":
    main()
