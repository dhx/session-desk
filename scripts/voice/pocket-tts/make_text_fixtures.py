"""Write the reference fixtures for the TypeScript tokenizer and text chunking.

Runs the pocket-tts reference (tokenizer.json through HuggingFace tokenizers, text_chunking.py)
over a fixed set of inputs and writes what it produced. The tests compare the port against it.

    python scripts/voice/pocket-tts/make_text_fixtures.py tests/fixtures/voice/pocket-tts
"""

import json
import sys
from pathlib import Path

from pocket_tts.models.text_chunking import prepare_text_prompt, split_into_best_sentences
from pocket_tts.utils.config import load_config
from pocket_tts.utils.utils import download_if_necessary
from tokenizers import Tokenizer

CONFIGS = Path(__import__("pocket_tts").__file__).parent / "config"

INPUTS = [
    "Der Bild ist jetzt fertig.",
    "Soll ich den Pull Request jetzt mördschen?",
    "  Hallo, Welt; äöü ß 123!",
    "Version 2.15 ist da. Danach 3.0.",
    "„Fertig?“, fragte sie. – Ja — fast; noch (kurz) [eben] warten",
    "ich habe drei Kommitts gepuscht und der Pull Request wartet auf dein Review",
    "Emoji 🙂 und Zeichen wie <s>, € und ½ gehen auch",
    "The build is done. I pushed three commits, and the pull request is waiting for your review. Should I merge it?",
    "e.g. node 22.12 works: run it now",
    "Quick question:",
    "one",
    "Line one\nline two\r\nline three",
    "Ein sehr langer Satz, der mehr als zwölf Token hat, damit die Aufteilung an Kommas greift, und noch ein Stück, und noch eins",
]


def main(out_dir: str) -> None:
    out = Path(out_dir)
    for lang in ("german", "english"):
        cfg = load_config(str(CONFIGS / f"{lang}.yaml"))
        tok_path = download_if_necessary(str(cfg.flow_lm.lookup_table.tokenizer_path))
        # One line each: the repository caps files at 500 lines.
        tok_json = json.loads(Path(tok_path).read_text())
        (out / f"{lang}.tokenizer.json").write_text(json.dumps(tok_json, ensure_ascii=False, separators=(",", ":")) + "\n")
        hf = Tokenizer.from_file(str(tok_path))

        class Tok:
            def encode(self, s):
                return hf.encode(s).ids

            def decode(self, ids):
                return hf.decode(list(ids))

            def __call__(self, s):
                import torch

                return torch.tensor([self.encode(s)])

        options = dict(
            pad_with_spaces_for_short_inputs=cfg.pad_with_spaces_for_short_inputs,
            remove_semicolons=cfg.remove_semicolons,
            append_terminal_punctuation=cfg.append_terminal_punctuation,
            capitalize_first_letter=cfg.capitalize_first_letter,
            replace_characters=cfg.replace_characters or {},
        )
        cases = []
        for text in INPUTS:
            ids = hf.encode(text).ids
            prepared, guess = prepare_text_prompt(text, **options)
            cases.append(
                {
                    "input": text,
                    "ids": ids,
                    "decoded": hf.decode(ids),
                    "prepared": prepared,
                    "framesAfterEosGuess": guess,
                    "chunks50": split_into_best_sentences(Tok(), text, 50, **options),
                    "chunks12": split_into_best_sentences(Tok(), text, 12, **options),
                }
            )
        fixture = {
            "language": lang,
            "options": {
                "padWithSpacesForShortInputs": options["pad_with_spaces_for_short_inputs"],
                "removeSemicolons": options["remove_semicolons"],
                "appendTerminalPunctuation": options["append_terminal_punctuation"],
                "capitalizeFirstLetter": options["capitalize_first_letter"],
                "replaceCharacters": options["replace_characters"],
            },
            "cases": cases,
        }
        (out / f"{lang}.text.json").write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(lang, len(cases))


if __name__ == "__main__":
    main(sys.argv[1])
