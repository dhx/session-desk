export const enVoiceShortcuts = {
  group: {
    title: 'Voice',
    help: 'Hold the key to talk to your boss agent. Release it to send.',
  },
  command: {
    title: 'Push to Talk',
    help: 'Hold to record a voice command for the boss agent.',
  },
}

export const enVoice = {
  voice: {
    settings: {
      groupTitle: 'Voice control',
      groupHelp:
        'Hold the push-to-talk key or button, speak a command, and the boss agent runs it. Speech is processed on this server and goes nowhere else.',
      enabledLabel: 'Enable voice control',
      enabledHelp:
        'Voice settings are shared by everyone who uses this server. The first press after a while takes a few seconds while the models load.',
      notInstalled:
        'Voice is not installed on this server: it has no speech models. Ask whoever runs it to install them.',
      engineLabel: 'Engine',
      engineHelp: 'Local runs Whisper and Pocket TTS on this server.',
      engineLocal: 'Local (Whisper + Pocket TTS)',
      engineRealtime: 'OpenAI Realtime',
      comingSoon: 'Coming soon',
      languageLabel: 'Reply language',
      languageHelp:
        'Automatic answers in the language you spoke. The voice is the one installed on this server.',
      voiceMissing:
        'No voice is installed on this server for {{languages}}, so replies in it cannot be read out loud.',
      languages: {
        auto: 'Automatic',
        de: 'German',
        en: 'English',
      },
      bossLabel: 'Boss agent',
      bossHelp: 'The agent that receives your voice commands.',
      bossNone: 'None',
      bossMissing: 'Pick an agent. The one you chose before was closed.',
      bossNoAgents: 'Open an agent on the canvas first.',
      speakRepliesLabel: 'Speak replies',
      speakRepliesHelp: 'Read a short summary of the reply out loud when the boss finishes.',
      shortcutHelp: 'Push-to-talk key: {{shortcut}}. Change it in Settings > Quick Actions.',
    },
    holdButton: {
      label: 'Hold to talk to {{boss}}',
    },
    indicator: {
      loadingModels: 'Loading voice models…',
      loadingModelsProgress: 'Loading voice models: {{percent}}%',
      notInstalled: 'Voice is not installed on this server.',
      listening: 'Listening…',
      transcribing: 'Transcribing…',
      sending: 'Sending to {{boss}}',
      waiting: '{{boss}} is working',
      speaking: 'Speaking',
      cancelled: 'Cancelled',
      engineError: 'Voice models failed to load: {{message}}',
      errors: {
        'no-speech': 'No speech heard. Hold the key or button and try again.',
        'no-boss': 'Pick a boss agent in Settings > Agent > Voice.',
        'mic-failed': 'The microphone is not available.',
        'transcribe-failed': 'Could not turn the speech into text.',
        'send-failed': 'Could not send the command to the boss agent.',
        'speak-failed': 'Could not read the reply out loud.',
      },
    },
  },
}
