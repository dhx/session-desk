export const zhCNVoiceShortcuts = {
  group: {
    title: '语音',
    help: '按住按键对主控 Agent 说话，松开即发送。',
  },
  command: {
    title: '按住说话',
    help: '按住以录制发给主控 Agent 的语音指令。',
  },
}

export const zhCNVoice = {
  voice: {
    settings: {
      groupTitle: '语音控制',
      groupHelp:
        '按住说话键或按钮，说出指令，主控 Agent 就会执行。语音只在此服务器上处理，不会发往别处。',
      enabledLabel: '启用语音控制',
      enabledHelp:
        '语音设置由使用此服务器的所有人共享。闲置一段时间后，第一次按下需要几秒钟加载模型。',
      notInstalled: '此服务器未安装语音：缺少语音模型。请联系服务器管理员安装。',
      engineLabel: '引擎',
      engineHelp: '本地引擎在此服务器上运行 Whisper 与 Pocket TTS。',
      engineLocal: '本地（Whisper + Pocket TTS）',
      engineRealtime: 'OpenAI Realtime',
      comingSoon: '即将推出',
      languageLabel: '回复语言',
      languageHelp: '自动：用你说话的语言回复。声音为此服务器上安装的声音。',
      voiceMissing: '此服务器未安装{{languages}}的声音，该语言的回复无法朗读。',
      languages: {
        auto: '自动',
        de: '德语',
        en: '英语',
      },
      bossLabel: '主控 Agent',
      bossHelp: '接收语音指令的 Agent。',
      bossNone: '无',
      bossMissing: '请重新选择。之前选择的 Agent 已关闭。',
      bossNoAgents: '请先在画布上打开一个 Agent。',
      speakRepliesLabel: '朗读回复',
      speakRepliesHelp: '主控 Agent 完成后，朗读回复的简短摘要。',
      shortcutHelp: '按住说话键：{{shortcut}}。可在 设置 > 快捷操作 中修改。',
    },
    holdButton: {
      label: '按住对 {{boss}} 说话',
    },
    indicator: {
      loadingModels: '正在加载语音模型…',
      loadingModelsProgress: '正在加载语音模型：{{percent}}%',
      notInstalled: '此服务器未安装语音。',
      listening: '正在聆听…',
      transcribing: '正在识别…',
      sending: '正在发送给 {{boss}}',
      waiting: '{{boss}} 正在工作',
      speaking: '正在朗读',
      cancelled: '已取消',
      engineError: '语音模型加载失败：{{message}}',
      errors: {
        'no-speech': '没有听到语音。请按住按键或按钮重试。',
        'no-boss': '请在 设置 > Agent > 语音 中选择主控 Agent。',
        'mic-failed': '麦克风不可用。',
        'transcribe-failed': '无法把语音转成文字。',
        'send-failed': '无法把指令发送给主控 Agent。',
        'speak-failed': '无法朗读回复。',
      },
    },
  },
}
