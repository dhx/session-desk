import {
  isRecord,
  normalizeBoolean,
  normalizeTextValue,
} from '../../settings/domain/settingsNormalization'
import { VOICE_LANGUAGES, type VoiceLanguage } from '../../../shared/contracts/dto'

export const VOICE_ENGINE_IDS = ['local', 'openai-realtime'] as const
export type VoiceEngineId = (typeof VOICE_ENGINE_IDS)[number]

/** Which language replies are spoken in: the language the request was spoken in, or a fixed one. */
export const VOICE_LANGUAGE_SETTINGS = ['auto', ...VOICE_LANGUAGES] as const
export type VoiceLanguageSetting = (typeof VOICE_LANGUAGE_SETTINGS)[number]

/** The language to speak a reply in, for the language the request was heard in. */
export function resolveReplyLanguage(
  setting: VoiceLanguageSetting,
  heard: VoiceLanguage | null,
): VoiceLanguage {
  return setting === 'auto' ? (heard ?? 'en') : setting
}

export interface VoiceSettings {
  enabled: boolean
  engine: VoiceEngineId
  language: VoiceLanguageSetting
  /** The agent node that receives voice prompts; null until the user picks one. */
  bossNodeId: string | null
  speakReplies: boolean
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  engine: 'local',
  language: 'auto',
  bossNodeId: null,
  speakReplies: true,
}

function isVoiceEngineId(value: unknown): value is VoiceEngineId {
  return VOICE_ENGINE_IDS.includes(value as VoiceEngineId)
}

function isVoiceLanguageSetting(value: unknown): value is VoiceLanguageSetting {
  return VOICE_LANGUAGE_SETTINGS.includes(value as VoiceLanguageSetting)
}

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const input = isRecord(value) ? value : {}
  const bossNodeId = normalizeTextValue(input.bossNodeId)

  return {
    enabled: normalizeBoolean(input.enabled) ?? DEFAULT_VOICE_SETTINGS.enabled,
    engine: isVoiceEngineId(input.engine) ? input.engine : DEFAULT_VOICE_SETTINGS.engine,
    language: isVoiceLanguageSetting(input.language)
      ? input.language
      : DEFAULT_VOICE_SETTINGS.language,
    bossNodeId: bossNodeId.length > 0 ? bossNodeId : null,
    speakReplies: normalizeBoolean(input.speakReplies) ?? DEFAULT_VOICE_SETTINGS.speakReplies,
  }
}
