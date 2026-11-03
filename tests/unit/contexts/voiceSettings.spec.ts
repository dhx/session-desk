import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_VOICE_SETTINGS,
  normalizeVoiceSettings,
  resolveReplyLanguage,
} from '../../../src/contexts/voice/domain/voiceSettings'

describe('normalizeVoiceSettings', () => {
  it('defaults to disabled, local engine, automatic language, no boss, spoken replies', () => {
    expect(normalizeVoiceSettings(undefined)).toEqual({
      enabled: false,
      engine: 'local',
      language: 'auto',
      bossNodeId: null,
      speakReplies: true,
    })
  })

  it('keeps valid saved values', () => {
    const saved = {
      enabled: true,
      engine: 'openai-realtime',
      language: 'de',
      bossNodeId: 'node-1',
      speakReplies: false,
    }
    expect(normalizeVoiceSettings(saved)).toEqual(saved)
  })

  it('replaces each invalid field with its default and keeps the valid ones', () => {
    expect(
      normalizeVoiceSettings({
        enabled: 'yes',
        engine: 'whisper-cloud',
        language: 'fr',
        bossNodeId: '   ',
        speakReplies: false,
      }),
    ).toEqual({ ...DEFAULT_VOICE_SETTINGS, speakReplies: false })
  })

  it('drops the Kokoro voice of settings saved before Pocket TTS', () => {
    expect(normalizeVoiceSettings({ voice: 'bm_george', enabled: true })).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      enabled: true,
    })
  })

  it('trims the boss node id', () => {
    expect(normalizeVoiceSettings({ bossNodeId: ' node-7 ' }).bossNodeId).toBe('node-7')
  })
})

describe('agent settings voice field', () => {
  it('fills voice defaults for settings saved before voice existed', () => {
    const { voice: _voice, ...legacy } = DEFAULT_AGENT_SETTINGS
    const normalized = normalizeAgentSettings(legacy)
    expect(normalized.voice).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(isNormalizedAgentSettings(legacy)).toBe(false)
    expect(isNormalizedAgentSettings(normalized)).toBe(true)
  })

  it('round-trips user voice choices', () => {
    const voice = { ...DEFAULT_VOICE_SETTINGS, enabled: true, language: 'en' as const }
    expect(normalizeAgentSettings({ ...DEFAULT_AGENT_SETTINGS, voice }).voice).toEqual(voice)
  })
})

describe('resolveReplyLanguage', () => {
  it('answers in the language heard when automatic, English before anything was heard', () => {
    expect(resolveReplyLanguage('auto', 'de')).toBe('de')
    expect(resolveReplyLanguage('auto', 'en')).toBe('en')
    expect(resolveReplyLanguage('auto', null)).toBe('en')
  })

  it('keeps a fixed language whatever was heard', () => {
    expect(resolveReplyLanguage('de', 'en')).toBe('de')
    expect(resolveReplyLanguage('en', 'de')).toBe('en')
  })
})
