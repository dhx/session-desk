const SIGNALS = {
  '<test-hook-initial-working>': {
    version: 1,
    state: 'working',
    hookEventName: 'UserPromptSubmit',
  },
  '<test-hook-tool>': {
    version: 1,
    state: 'working',
    hookEventName: 'PreToolUse',
    tool: { name: 'Bash', useId: 'tool-ordinary', input: { command: 'true' } },
  },
  '<test-hook-waiting>': {
    version: 1,
    state: 'waiting',
    hookEventName: 'PermissionRequest',
    tool: { name: 'Bash', useId: 'tool-waiting', input: { command: 'pnpm test' } },
  },
  '<test-hook-done>': {
    version: 1,
    state: 'done',
    hookEventName: 'Stop',
  },
}

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { appendClaudeRecord, resolveScenarioSessionFile } from '../test-agent-session-jsonl.mjs'

async function postHook(envelope) {
  const endpoint = process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT
  const token = process.env.OPENCOVE_CLAUDE_HOOK_TOKEN
  if (!endpoint || !token) {
    throw new Error('Claude hook stub did not receive its correlation environment.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencove-hook-token': token,
    },
    body: JSON.stringify(envelope),
  })
  if (!response.ok) {
    throw new Error(`Claude hook stub POST failed with ${response.status}.`)
  }
}

async function runClaudeHookScenario(
  cwd,
  { sessionFileWarmStandby, mode = 'new', resumeSessionId = null },
) {
  const sessionFilePath = sessionFileWarmStandby
    ? (await resolveScenarioSessionFile({ provider: 'claude-code', cwd, mode, resumeSessionId }))
        .sessionFilePath
    : null
  const claudeSessionId =
    resumeSessionId?.trim() ||
    (sessionFilePath ? basename(sessionFilePath, '.jsonl') : randomUUID())
  if (sessionFilePath) {
    await appendClaudeRecord(sessionFilePath, {
      type: 'user',
      message: { content: [{ type: 'text', text: 'Begin arbitration test.' }] },
    })
  }
  process.stdout.write('[opencove-test-hook] ready\n')

  await new Promise((resolveRun, reject) => {
    let input = ''
    let operation = Promise.resolve()
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.pause()
    }
    const onData = chunk => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 0x03) {
          cleanup()
          void operation.then(resolveRun, reject)
          return
        }
        input += String.fromCharCode(byte)
        if (sessionFilePath && input.endsWith('<test-session-standby>')) {
          input = ''
          operation = operation.then(async () => {
            await appendClaudeRecord(sessionFilePath, {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'Conflicting fallback standby.' }],
                stop_reason: 'end_turn',
              },
            })
            process.stdout.write('[opencove-test-hook] session-standby\n')
          })
          continue
        }
        const matched = Object.entries(SIGNALS).find(([signal]) => input.endsWith(signal))
        if (matched) {
          input = ''
          operation = operation.then(async () => {
            await postHook({ ...matched[1], claudeSessionId })
            process.stdout.write(`[opencove-test-hook] ${matched[1].state}\n`)
          })
        } else if (input.length > 64) {
          input = input.slice(-64)
        }
      }
    }
    process.stdin.on('data', onData)
    process.stdin.resume()
  })
}

export async function runClaudeHookLifecycleScenario(cwd, identity = {}) {
  await runClaudeHookScenario(cwd, { ...identity, sessionFileWarmStandby: false })
}

export async function runClaudeHookArbitrationScenario(cwd, identity = {}) {
  await runClaudeHookScenario(cwd, { ...identity, sessionFileWarmStandby: true })
}

export async function runClaudeHookFallbackScenario(
  cwd,
  { mode = 'new', resumeSessionId = null } = {},
) {
  const { sessionFilePath } = await resolveScenarioSessionFile({
    provider: 'claude-code',
    cwd,
    mode,
    resumeSessionId,
  })
  await appendClaudeRecord(sessionFilePath, {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Fallback ready.' }],
      stop_reason: 'end_turn',
    },
  })
  process.stdout.write('[opencove-test-hook-fallback] ready\n')
  await new Promise(resolveRun => {
    process.stdin.on('data', chunk => {
      if (Buffer.from(chunk).includes(0x03)) {
        resolveRun()
      }
    })
    process.stdin.resume()
  })
}

/**
 * The SAY line a voice turn reads aloud, in the language the voice instruction asks for, as a real
 * agent would write it; the voice E2E expects to hear the one it asked for.
 */
export const VOICE_REPLY_SAY_LINES = {
  German: 'Du hast zwei Agents.',
  English: 'You have two agents.',
}

/** Numbered, so each reply differs from the one before; a repeated reply counts as no reply. */
function voiceReply(turn, language) {
  const sayLine = VOICE_REPLY_SAY_LINES[language] ?? VOICE_REPLY_SAY_LINES.English
  return `Turn ${turn}: two agents are running.\nSAY: ${sayLine}`
}

/**
 * Answers each submitted prompt the way Claude Code 2.1 does: a raw UserPromptSubmit hook, then a
 * raw Stop hook whose payload carries the reply as `last_assistant_message`.
 */
export async function runClaudeHookVoiceReplyScenario(cwd) {
  const claudeSessionId = randomUUID()
  const raw = hookEventName => ({
    session_id: claudeSessionId,
    transcript_path: `${cwd}/${claudeSessionId}.jsonl`,
    cwd,
    hook_event_name: hookEventName,
  })
  process.stdout.write('[opencove-test-voice] ready\n')
  let turn = 0

  await new Promise(resolveRun => {
    let line = ''
    let operation = Promise.resolve()
    process.stdin.on('data', chunk => {
      for (const character of Buffer.from(chunk).toString('utf8')) {
        if (character === '\x03') {
          process.stdin.pause()
          void operation.then(resolveRun)
          return
        }
        // A cooked Unix TTY turns the submitted \r into \n; Windows ConPTY passes \r through.
        if (character !== '\r' && character !== '\n') {
          line += character
          continue
        }
        const prompt = line.trim()
        line = ''
        if (!prompt) {
          continue
        }
        operation = operation.then(async () => {
          // Short lines, so a narrow test terminal never wraps the text the E2E looks for.
          const [heard, instruction] = prompt.split(' (Voice request:')
          process.stdout.write(`[opencove-test-voice] heard: ${heard}\n`)
          process.stdout.write(`[opencove-test-voice] instruction: ${instruction !== undefined}\n`)
          const language = /spoken summary in (\w+)/.exec(instruction ?? '')?.[1] ?? 'none'
          process.stdout.write(`[opencove-test-voice] reply language: ${language}\n`)
          await postHook(raw('UserPromptSubmit'))
          await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
          turn += 1
          await postHook({ ...raw('Stop'), last_assistant_message: voiceReply(turn, language) })
          process.stdout.write('[opencove-test-voice] replied\n')
        })
      }
    })
    process.stdin.resume()
  })
}
