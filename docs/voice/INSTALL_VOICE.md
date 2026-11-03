# Installing a voice

How an installation gets the voice its replies are spoken in. The image carries the speech models (Whisper and Pocket TTS, open weights) but no voice: a voice is made once from a recording of a real person and stays with the installation, outside git and the image. Background: [POCKET_TTS_SPEC.md](POCKET_TTS_SPEC.md).

Without a voice, voice control still hears you, but replies in a language without a voice are not read out (Settings › Agent › Voice says which languages have none; speaking one answers `voice.voice_missing`).

## What you need

- **Consent.** Only the person whose voice it is, or someone with their written consent, makes a voice from it. Pocket TTS's terms forbid imitating anyone without it. Keep the consent with the installation's records, apart from the recording.
- **A recording**: 5 to 10 seconds of clean speech by that person, one speaker, no music or noise, as WAV (mono is fine). One recording serves both languages; longer ones are cut to 30 seconds.
- **A workstation with Python 3.10 or newer**, not the server: cloning needs the gated model and a Hugging Face token, and neither belongs on the server.
- **A Hugging Face account** that has accepted the terms of [`kyutai/pocket-tts`](https://huggingface.co/kyutai/pocket-tts) (the cloning model; the server uses the open `kyutai/pocket-tts-without-voice-cloning`).

The recording and the voice files are personal data: no git, no chat, no ticket, no CI artifact. Keep them in a folder only you can read (`chmod 700`).

## 1. Make the voice files

On the workstation:

```bash
python3 -m venv ~/pocket-tts && . ~/pocket-tts/bin/activate
pip install pocket-tts==4.0.1    # the version the server's models were exported from
hf auth login                    # a read token; stays on this machine

pocket-tts export-voice recording.wav german.safetensors --language german
pocket-tts export-voice recording.wav english.safetensors --language english
```

Use exactly `german` and `english`, not `german_24l` or a dated English model: the voice belongs to the model it was made with, and the server runs these two. Each file is about 4 MB.

Listen before you install them:

```bash
pocket-tts generate --language german --voice german.safetensors \
  --text "Der Bild ist jetzt fertig. Soll ich den Pull Request mördschen?" --output-path de.wav
pocket-tts generate --language english --voice english.safetensors \
  --text "The build is done. Should I merge the pull request?" --output-path en.wav
```

(The odd German spelling is how the server writes these words before speaking them; see [Pronunciation](#pronunciation).) The English sample runs on the gated English model here; the server's open one differs slightly but keeps the voice.

When the files are on the server (step 2), delete the recording from the workstation or keep it encrypted, and log out of Hugging Face if the token is not needed any more.

## 2. Put them on the server

The voice files are binary, so they go in a directory on the server that is mounted into the container. A Coolify **File Mount** does not fit: it holds text that Coolify manages.

On the server, as a user who can write there:

```bash
sudo mkdir -p /srv/opencove-voice
sudo chmod 750 /srv/opencove-voice
# from the workstation:
scp german.safetensors english.safetensors server:/srv/opencove-voice/
```

The container user must be able to read the files. Find it with `docker exec <container> id` and give the files that group (`sudo chgrp -R <gid> /srv/opencove-voice && sudo chmod 640 /srv/opencove-voice/*`).

In Coolify, on the session-desk application:

1. **Persistent Storage › Add › Directory Mount**: source `/srv/opencove-voice`, destination `/opt/opencove-voice/voice`. Read-only is enough; nothing writes there.
2. **Environment Variables**: `OPENCOVE_VOICE_DIR=/opt/opencove-voice/voice`.
3. **Redeploy.**

The file names matter: `german.safetensors` and `english.safetensors`. One of them is enough for that language.

## 3. Check it

In the Web UI, Settings › Agent › Voice: turn voice on and wait until the models have loaded (the first press takes a few seconds). The help under **Reply language** names any language that still has no voice. Then hold the push-to-talk key and ask something in German, then in English; the reply should come back in that language, in that voice.

If it does not:

| You see | Meaning |
| --- | --- |
| "No voice is installed on this server for German" (or English) | The file is not where `OPENCOVE_VOICE_DIR` points, is named differently, or is not readable by the container user. |
| "Voice is not installed on this server" | The image has no speech models (`OPENCOVE_VOICE_MODELS_DIR`); that is the image's part, not the voice's. |
| Replies are not read out ("Could not read the reply out loud"), and the `/voice/speak` response (browser dev tools, Network) says "Voice state does not fit this model" or "Voice state has no cache for …" | The file was made with another model, such as `german_24l`. Make it again with `--language german` or `--language english`. |
| The same, with "Voice states with padding are not supported" | The file was made another way than `export-voice`. Make it again as in step 1. |

A changed voice file is read when its language next loads: after the voice host has been idle for 10 minutes, or after a redeploy.

## Pronunciation

The German model reads English developer words by German rules. Before speaking, the server writes a few of them the way it says them right: Build → Bild, Merge → Mördsch, Commit → Kommitt, Deploy → Diploi, Push → Pusch. Only what is spoken changes; the text on screen stays as written.

An installation adds its own words in `lexicon.german.json` or `lexicon.english.json` in the same directory as the voices. These are text files, so a Coolify File Mount works too (destination `/opt/opencove-voice/voice/lexicon.german.json`):

```json
{
  "Kubernetes": "Kuberneetis",
  "Pull Request": "Pull Rikwest"
}
```

- Written → spoken. Whole words or phrases, ignoring case; the spoken form takes the case of the first letter. An entry wins over the built-in spelling of the same word.
- Inflected forms are separate words: add `"Builds": "Bilds"` if you need it.
- At most 1000 entries of up to 100 characters each, 256 KB per file.
- A broken file is reported in the container log (Coolify › Logs: "voice lexicon … ignored: …") and ignored; replies go on with the built-in list.
- Like the voices, an edited lexicon applies when the language next loads.

Try a spelling with `pocket-tts generate` (step 1) before adding it.

## Removing a voice

Delete the file from `/srv/opencove-voice` (and the backups that hold it), then redeploy or wait for the idle unload. Replies in that language are then not read out until a new voice is installed. When the person withdraws consent, also delete the recording and any other copy of the voice files.
