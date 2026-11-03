"""Export a Pocket TTS language to the ONNX bundle the voice host runs.

    pip install -r scripts/voice/pocket-tts/requirements.txt
    python scripts/voice/pocket-tts/export.py german  <out>/german
    python scripts/voice/pocket-tts/export.py english <out>/english [--keep-fp32]

Uses the open weights (kyutai/pocket-tts-without-voice-cloning, CC-BY-4.0) at the revision the
pinned pocket-tts release names; no Hugging Face token is needed or wanted. Writes four int8
graphs, the tokenizer and bundle.json, which carries everything the TypeScript side needs.
With --keep-fp32 it also writes the unquantized bundle to <out>-fp32, which reference.py
--check-pytorch compares against the PyTorch model.

Graphs, each with its streaming state passed in and returned:
  text_conditioner  token_ids [1,T]                       -> text_embeddings [1,T,1024]
  flow_lm_main      sequence [1,S,32] (NaN = BOS), text_embeddings [1,T,1024],
                    kv [layers,2,1,C,heads,64], offset [1] -> conditioning, eos_logit, kv, offset
  flow_lm_flow      c, s, t, x                             -> flow (one LSD step)
  mimi_decoder      latent [1,F,32] + state_i              -> audio [1,1,F*1920] + out_state_i

pocket-tts writes its KV cache in place at a Python int (complete_kv), which does not export.
It is replaced here by a scatter at offset+arange(n) that returns the whole cache. Unwritten
slots must therefore be zero, not NaN: the causal mask hides them, but 0*NaN would not.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from torch import nn

import pocket_tts
import pocket_tts.modules.attention as attention
from pocket_tts import TTSModel
from pocket_tts.models.tts_model import TTSModel as _TTS
from pocket_tts.modules.stateful_module import StatefulModule, increment_steps, init_states
from pocket_tts.utils.utils import download_if_necessary

STATE_KEYS = ("previous", "partial", "cache", "offset")


def complete_kv(cache, offset, k, v):
    n = k.shape[1]
    pos = offset.view(-1)[:1] + torch.arange(n, dtype=torch.long)
    idx = pos.view(1, n, 1, 1).expand(k.shape[0], n, k.shape[2], k.shape[3])
    keys = cache[0].scatter(1, idx, k)
    values = cache[1].scatter(1, idx, v)
    cache.copy_(torch.stack([keys, values]))
    return keys, values


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def quantize(src: Path, dst: Path) -> None:
    model = onnx.load(str(src))
    # The exporter's stored shapes trip the quantizer's shape inference; it infers its own.
    del model.graph.value_info[:]
    stripped = src.with_suffix(".noshape.onnx")
    onnx.save(model, str(stripped))
    quantize_dynamic(
        str(stripped),
        str(dst),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul", "Gemm"],
        extra_options={"DefaultTensorType": onnx.TensorProto.FLOAT},
    )
    stripped.unlink()


def main(language: str, out: Path) -> None:
    if os.environ.get("HF_TOKEN"):
        sys.exit("Unset HF_TOKEN: the bundle must come from the open weights only.")
    attention.complete_kv = complete_kv
    torch.set_grad_enabled(False)
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "fp32"
    tmp.mkdir(exist_ok=True)

    model = TTSModel.load_model(language=language)
    assert not model.has_voice_cloning, "expected the open weights without voice cloning"
    flow, mimi = model.flow_lm, model.mimi
    layers = [name for name, mod in flow.named_modules() if isinstance(mod, StatefulModule)]
    attn = flow.transformer.layers[0].self_attn
    heads, head_dim = attn.num_kv_heads, attn.dim_per_head
    steps_per_latent = int(mimi.encoder_frame_rate / mimi.frame_rate)
    mimi_init = init_states(mimi, batch_size=1, sequence_length=64)
    mimi_names = [
        (name, key)
        for name, mod in mimi.named_modules()
        if isinstance(mod, StatefulModule)
        for key in STATE_KEYS
        if key in mimi_init[name]
    ]

    class TextConditioner(nn.Module):
        def forward(self, token_ids):
            return flow.conditioner(token_ids)

    class FlowMain(nn.Module):
        def forward(self, sequence, text_embeddings, kv, offset):
            state = {n: dict(cache=kv[i].clone(), offset=offset.clone()) for i, n in enumerate(layers)}
            latents = torch.where(torch.isnan(sequence), flow.bos_emb, sequence)
            x = torch.cat([text_embeddings, flow.input_linear(latents)], dim=1)
            h = flow.out_norm(flow.transformer(x, state))[:, -1]
            if flow.z_proj is not None:
                h = flow.z_proj(h)
            h = h.to(torch.float32)
            kv_out = torch.stack([state[n]["cache"] for n in layers])
            return h, flow.out_eos(h), kv_out, offset + text_embeddings.shape[1] + sequence.shape[1]

    class FlowNet(nn.Module):
        def forward(self, c, s, t, x):
            return flow.flow_net(c, s, t, x)

    class MimiDecoder(nn.Module):
        def forward(self, latent, *flat):
            state = {n: {k: v for k, v in s.items() if k != "pad"} for n, s in mimi_init.items()}
            for (name, key), tensor in zip(mimi_names, flat):
                state[name][key] = tensor.clone()
            audio = mimi.decode_from_latent(latent * flow.emb_std + flow.emb_mean, state)
            increment_steps(mimi, state, increment=steps_per_latent * latent.shape[1])
            return (audio, *[state[n][k] for n, k in mimi_names])

    def export(module, args, inputs, outputs, dynamic, name):
        torch.onnx.export(
            module, args, tmp / name, input_names=inputs, output_names=outputs,
            dynamic_shapes=dynamic, dynamo=True, optimize=True, external_data=False,
        )

    dim = torch.export.Dim
    export(TextConditioner(), (torch.tensor([[1, 2, 3]]),), ["token_ids"], ["text_embeddings"],
           {"token_ids": {1: dim("T", min=1, max=4096)}}, "text_conditioner.onnx")
    export(
        FlowMain(),
        (torch.zeros(1, 1, flow.ldim), torch.zeros(1, 2, flow.dim),
         torch.zeros(len(layers), 2, 1, 300, heads, head_dim), torch.tensor([5])),
        ["sequence", "text_embeddings", "kv", "offset"],
        ["conditioning", "eos_logit", "kv_out", "offset_out"],
        {"sequence": {1: dim("S", min=0, max=4096)}, "text_embeddings": {1: dim("TE", min=0, max=4096)},
         "kv": {3: dim("C", min=2, max=8192)}, "offset": None},
        "flow_lm_main.onnx",
    )
    export(FlowNet(), (torch.zeros(1, flow.dim), torch.zeros(1, 1), torch.ones(1, 1), torch.zeros(1, flow.ldim)),
           ["c", "s", "t", "x"], ["flow"], None, "flow_lm_flow.onnx")
    flat = [mimi_init[n][k] for n, k in mimi_names]
    export(
        MimiDecoder(), (torch.zeros(1, 3, flow.ldim), *flat),
        ["latent"] + [f"state_{i}" for i in range(len(flat))],
        ["audio"] + [f"out_state_{i}" for i in range(len(flat))],
        {"latent": {1: dim("F", min=1, max=512)},
         "flat": tuple({2: dim("MC", min=2, max=65536)} if k == "cache" else None for _, k in mimi_names)},
        "mimi_decoder.onnx",
    )

    (out / "text_conditioner.onnx").write_bytes((tmp / "text_conditioner.onnx").read_bytes())
    for name in ("flow_lm_main", "flow_lm_flow", "mimi_decoder"):
        quantize(tmp / f"{name}.onnx", out / f"{name}.onnx")
    tokenizer = Path(download_if_necessary(str(model.config.flow_lm.lookup_table.tokenizer_path)))
    targets = [out]
    if "--keep-fp32" in sys.argv:
        fp32 = out.parent / f"{out.name}-fp32"
        fp32.mkdir(exist_ok=True)
        for f in tmp.iterdir():
            f.replace(fp32 / f.name)
        targets.append(fp32)
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()

    files = ["text_conditioner.onnx", "flow_lm_main.onnx", "flow_lm_flow.onnx", "mimi_decoder.onnx", "tokenizer.json"]
    for target in targets:
        (target / "tokenizer.json").write_bytes(tokenizer.read_bytes())
        bundle = {
            "format": 1,
            "language": language,
            "pocketTts": "4.0.1",
            "weights": str(model.config.weights_path_without_voice_cloning),
            "tokenizer": str(model.config.flow_lm.lookup_table.tokenizer_path),
            "license": "CC-BY-4.0 (weights, Kyutai); code MIT",
            "sampleRate": model.sample_rate,
            "samplesPerFrame": int(model.sample_rate / mimi.frame_rate),
            "frameRate": mimi.frame_rate,
            "latentDim": flow.ldim,
            "modelDim": flow.dim,
            "flowLayers": len(layers),
            "kvHeads": heads,
            "headDim": head_dim,
            "flowStateModules": layers,
            "insertBosBeforeVoice": bool(flow.insert_bos_before_voice),
            "eosThreshold": model.eos_threshold,
            "minFramesBeforeEos": _TTS._MIN_FRAMES_BEFORE_EOS,
            "tokensPerSecondEstimate": _TTS._TOKENS_PER_SECOND_ESTIMATE,
            "genSecondsPadding": _TTS._GEN_SECONDS_PADDING,
            "framesAfterEos": model.model_recommended_frames_after_eos,
            "defaultTemperature": model.temp,
            "samplerDecodeSteps": model.sampler_decode_steps,
            "maxTokensPerChunk": 50,
            "mimiStepsPerLatent": steps_per_latent,
            "mimiState": [
                {"key": k, "dtype": str(t.dtype).replace("torch.", ""), "shape": list(t.shape),
                 "growsWithFrames": k == "cache"}
                for (n, k), t in zip(mimi_names, flat)
            ],
            "text": {
                "padWithSpacesForShortInputs": model.pad_with_spaces_for_short_inputs,
                "removeSemicolons": model.remove_semicolons,
                "appendTerminalPunctuation": model.append_terminal_punctuation,
                "capitalizeFirstLetter": model.capitalize_first_letter,
                "replaceCharacters": model.replace_characters,
            },
            "files": {f: sha256(target / f) for f in files},
        }
        (target / "bundle.json").write_text(json.dumps(bundle, indent=1, ensure_ascii=False) + "\n")
        print(target, json.dumps({k: bundle[k] for k in ("language", "weights", "files")}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
