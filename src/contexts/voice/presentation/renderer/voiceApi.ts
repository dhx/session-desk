import type { GetSessionFinalMessageResult } from '@shared/contracts/dto'

type VoiceBridge = NonNullable<Window['opencoveApi']['voice']>

/** The only voice file that touches `window.opencoveApi`. Null where no voice engine is offered. */
export function getVoiceBridge(): VoiceBridge | null {
  return typeof window !== 'undefined' ? (window.opencoveApi?.voice ?? null) : null
}

export function getPlatform(): string | undefined {
  return typeof window !== 'undefined' ? window.opencoveApi?.meta?.platform : undefined
}

export async function writeBossInput(
  nodeId: string,
  sessionId: string,
  data: string,
): Promise<void> {
  await window.opencoveApi.controlSurface.invoke({
    kind: 'command',
    id: 'session.writeNode',
    payload: { nodeId, sessionId, data },
  })
}

export async function readFinalMessage(sessionId: string): Promise<string | null> {
  // The Worker keeps the reply a turn-end hook reported (Claude's Stop hook); prefer it.
  const fromTurn = await window.opencoveApi.controlSurface
    .invoke<{ message: string }>({
      kind: 'query',
      id: 'agent.finalMessage',
      payload: { sessionId },
    })
    .then(result => result.message)
    .catch(() => null)
  if (fromTurn !== null) {
    return fromTurn
  }
  // Providers without such a hook: read the reply from the session file.
  const result = await window.opencoveApi.controlSurface.invoke<GetSessionFinalMessageResult>({
    kind: 'query',
    id: 'session.finalMessage',
    payload: { sessionId },
  })
  return result.message
}
