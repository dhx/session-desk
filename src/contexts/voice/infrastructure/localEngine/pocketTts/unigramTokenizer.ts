/**
 * The Unigram tokenizer of Pocket TTS, read from its `tokenizer.json`.
 *
 * transformers.js ships a Unigram model too, but it ignores `byte_fallback`: digits, `q` and
 * other characters the 4000-piece vocabulary has no piece for come out as `<unk>` instead of
 * their UTF-8 bytes, and the model then cannot say them. This mirrors HuggingFace `tokenizers`
 * for the one configuration Pocket TTS uses and refuses any other:
 * normalizer Prepend("▁"), pre-tokenizer Metaspace(always, split), Unigram with byte fallback,
 * decoder Metaspace → ByteFallback → Fuse.
 */

const SPACE_MARK = '▁'
/** `tokenizers` scores an unknown character this far below the lowest piece. */
const UNKNOWN_PENALTY = 10

interface AddedToken {
  id: number
  content: string
  special: boolean
}

export interface UnigramTokenizer {
  encode(text: string): number[]
  decode(ids: readonly number[]): string
}

interface TokenizerJson {
  added_tokens?: unknown
  normalizer?: unknown
  pre_tokenizer?: unknown
  post_processor?: unknown
  decoder?: unknown
  model?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function flattenSequence(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return []
  }
  if (value.type === 'Sequence' && Array.isArray(value[key])) {
    return (value[key] as unknown[]).filter(isRecord)
  }
  return [value]
}

function assertSupported(json: TokenizerJson): void {
  const normalizers = flattenSequence(json.normalizer, 'normalizers')
  const preTokenizers = flattenSequence(json.pre_tokenizer, 'pretokenizers')
  const decoders = flattenSequence(json.decoder, 'decoders').map(step => step.type)
  const model = isRecord(json.model) ? json.model : {}
  const supported =
    normalizers.length === 1 &&
    normalizers[0].type === 'Prepend' &&
    normalizers[0].prepend === SPACE_MARK &&
    preTokenizers.length === 1 &&
    preTokenizers[0].type === 'Metaspace' &&
    preTokenizers[0].replacement === SPACE_MARK &&
    preTokenizers[0].prepend_scheme === 'always' &&
    preTokenizers[0].split === true &&
    (json.post_processor === null || json.post_processor === undefined) &&
    decoders.join(',') === 'Metaspace,ByteFallback,Fuse' &&
    model.type === 'Unigram' &&
    model.byte_fallback === true &&
    typeof model.unk_id === 'number' &&
    Array.isArray(model.vocab)
  if (!supported) {
    throw new Error('Unsupported Pocket TTS tokenizer configuration')
  }
}

function byteToken(byte: number): string {
  return `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`
}

export function createUnigramTokenizer(json: TokenizerJson): UnigramTokenizer {
  assertSupported(json)
  const model = json.model as { vocab: [string, number][]; unk_id: number }
  const unkId = model.unk_id
  const scores = new Map<string, { id: number; score: number }>()
  let minScore = Infinity
  let maxPieceLength = 1
  model.vocab.forEach(([piece, score], id) => {
    scores.set(piece, { id, score })
    minScore = Math.min(minScore, score)
    maxPieceLength = Math.max(maxPieceLength, Array.from(piece).length)
  })
  const unknownScore = minScore - UNKNOWN_PENALTY
  const pieces = model.vocab.map(([piece]) => piece)
  const added: AddedToken[] = (Array.isArray(json.added_tokens) ? json.added_tokens : [])
    .filter(isRecord)
    .filter(token => typeof token.id === 'number' && typeof token.content === 'string')
    .map(token => ({
      id: token.id as number,
      content: token.content as string,
      special: token.special === true,
    }))
    .filter(token => token.content.length > 0)

  /** Best segmentation of one pre-token, unknown runs fused, as piece strings. */
  const segment = (word: string): { piece: string; known: boolean }[] => {
    const chars = Array.from(word)
    const n = chars.length
    const best = new Array<number>(n + 1).fill(-Infinity)
    const back = new Array<{ start: number; known: boolean }>(n + 1)
    best[0] = 0
    for (let start = 0; start < n; start += 1) {
      if (best[start] === -Infinity) {
        continue
      }
      let hasSingle = false
      let candidate = ''
      for (let end = start + 1; end <= Math.min(n, start + maxPieceLength); end += 1) {
        candidate += chars[end - 1]
        const entry = scores.get(candidate)
        if (!entry) {
          continue
        }
        if (end === start + 1) {
          hasSingle = true
        }
        const total = best[start] + entry.score
        if (total > best[end]) {
          best[end] = total
          back[end] = { start, known: true }
        }
      }
      if (!hasSingle) {
        const total = best[start] + unknownScore
        if (total > best[start + 1]) {
          best[start + 1] = total
          back[start + 1] = { start, known: false }
        }
      }
    }
    const result: { piece: string; known: boolean }[] = []
    for (let end = n; end > 0; ) {
      const { start, known } = back[end]
      const piece = chars.slice(start, end).join('')
      const previous = result[0]
      if (!known && previous && !previous.known) {
        previous.piece = piece + previous.piece
      } else {
        result.unshift({ piece, known })
      }
      end = start
    }
    return result
  }

  const encodeText = (text: string): number[] => {
    if (text.length === 0) {
      return []
    }
    let normalized = SPACE_MARK + text.replaceAll(' ', SPACE_MARK)
    if (!normalized.startsWith(SPACE_MARK)) {
      normalized = SPACE_MARK + normalized
    }
    const words = normalized.split(new RegExp(`(?=${SPACE_MARK})`, 'u')).filter(Boolean)
    const ids: number[] = []
    for (const word of words) {
      for (const { piece } of segment(word)) {
        const known = scores.get(piece)
        if (known) {
          ids.push(known.id)
          continue
        }
        const bytes = Array.from(new TextEncoder().encode(piece), byte =>
          scores.get(byteToken(byte)),
        )
        if (bytes.every(entry => entry !== undefined)) {
          ids.push(...bytes.map(entry => entry!.id))
        } else {
          ids.push(unkId)
        }
      }
    }
    return ids
  }

  const encode = (text: string): number[] => {
    if (added.length === 0) {
      return encodeText(text)
    }
    const ids: number[] = []
    let rest = text
    while (rest.length > 0) {
      let hit: { index: number; token: AddedToken } | null = null
      for (const token of added) {
        const index = rest.indexOf(token.content)
        if (index >= 0 && (!hit || index < hit.index)) {
          hit = { index, token }
        }
      }
      if (!hit) {
        ids.push(...encodeText(rest))
        break
      }
      ids.push(...encodeText(rest.slice(0, hit.index)), hit.token.id)
      rest = rest.slice(hit.index + hit.token.content.length)
    }
    return ids
  }

  // Like `tokenizers`' decode(skip_special_tokens=True), the default pocket-tts relies on.
  const specialIds = new Set(added.filter(token => token.special).map(token => token.id))
  const decode = (ids: readonly number[]): string => {
    const tokens = ids.filter(id => !specialIds.has(id)).map(id => pieces[id] ?? '')
    const spaced = tokens.map((token, index) => {
      const text = token.replaceAll(SPACE_MARK, ' ')
      return index === 0 && text.startsWith(' ') ? text.slice(1) : text
    })
    let output = ''
    let pendingBytes: number[] = []
    const flush = (): void => {
      if (pendingBytes.length === 0) {
        return
      }
      try {
        output += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(pendingBytes))
      } catch {
        output += '�'.repeat(pendingBytes.length)
      }
      pendingBytes = []
    }
    for (const token of spaced) {
      const byte = /^<0x([0-9A-F]{2})>$/.exec(token)
      if (byte) {
        pendingBytes.push(Number.parseInt(byte[1], 16))
        continue
      }
      flush()
      output += token
    }
    flush()
    return output
  }

  return { encode, decode }
}
