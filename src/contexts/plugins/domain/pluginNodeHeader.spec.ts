import { describe, expect, it } from 'vitest'
import {
  normalizePluginNodeHeader,
  normalizePluginNodeHeaderState,
  pluginNodeHeaderUrl,
} from './pluginNodeHeader'
import { normalizeLocalPluginPackage } from './localPluginValidation'

const commands = [
  { id: 'header-state', title: 'State', description: 'Links', target: 'plugin' as const },
  { id: 'open', title: 'Open', description: 'Window', target: 'window' as const },
]

describe('plugin window header declarations', () => {
  it('accepts a button whose state comes from a declared backend command', () => {
    expect(
      normalizePluginNodeHeader(
        [{ id: 'board-card', title: ' Open card ', stateCommand: 'header-state' }],
        commands,
      ),
    ).toEqual([{ id: 'board-card', title: 'Open card', stateCommand: 'header-state' }])
    expect(normalizePluginNodeHeader(undefined, commands)).toEqual([])
  })

  it.each([
    ['an undeclared command', [{ id: 'a', title: 'A', stateCommand: 'missing' }]],
    ['a window command', [{ id: 'a', title: 'A', stateCommand: 'open' }]],
    ['an unknown field', [{ id: 'a', title: 'A', stateCommand: 'header-state', url: 'x' }]],
    [
      'a duplicate id',
      [
        { id: 'a', title: 'A', stateCommand: 'header-state' },
        { id: 'a', title: 'B', stateCommand: 'header-state' },
      ],
    ],
    [
      'too many buttons',
      Array.from({ length: 5 }, (_, i) => ({
        id: `b${i}`,
        title: 'B',
        stateCommand: 'header-state',
      })),
    ],
  ])('rejects %s', (_name, value) => {
    expect(() => normalizePluginNodeHeader(value, commands)).toThrow()
  })

  it('travels through the package validation', () => {
    const pkg = normalizeLocalPluginPackage({
      apiVersion: 1,
      id: 'board',
      version: '1.0.0',
      displayName: 'Board',
      description: 'Links windows',
      main: 'main.mjs',
      contributes: {
        commands: [commands[0]],
        nodeHeader: [{ id: 'card', title: 'Open card', stateCommand: 'header-state' }],
      },
    })
    expect(pkg.contributes?.nodeHeader).toEqual([
      { id: 'card', title: 'Open card', stateCommand: 'header-state' },
    ])
  })
})

describe('plugin window header state', () => {
  it('keeps http(s) links per window and drops everything else', () => {
    expect(
      normalizePluginNodeHeaderState({
        nodes: {
          'node-1': { url: 'https://board.example/#item=card_1' },
          'node-2': { url: 'http://localhost:8080/x', title: ' Card 2 ' },
          'node-3': { url: 'javascript:alert(1)' },
          'node-4': { url: 'file:///etc/passwd' },
          'node-5': { url: 'not a url' },
          'node-6': null,
        },
      }),
    ).toEqual({
      'node-1': { url: 'https://board.example/#item=card_1' },
      'node-2': { url: 'http://localhost:8080/x', title: 'Card 2' },
    })
    expect(normalizePluginNodeHeaderState({})).toEqual({})
  })

  it('rejects malformed or oversized answers', () => {
    expect(() => normalizePluginNodeHeaderState({ nodes: [] })).toThrow()
    expect(() => normalizePluginNodeHeaderState({ windows: {} })).toThrow()
    const many = Object.fromEntries(
      Array.from({ length: 2001 }, (_, i) => [`n${i}`, { url: 'https://a.example' }]),
    )
    expect(() => normalizePluginNodeHeaderState({ nodes: many })).toThrow()
  })

  it('opens only absolute http(s) addresses', () => {
    expect(pluginNodeHeaderUrl('https://a.example/p?q=1#x')).toBe('https://a.example/p?q=1#x')
    expect(pluginNodeHeaderUrl('data:text/html,x')).toBeNull()
    expect(pluginNodeHeaderUrl('/relative')).toBeNull()
    expect(pluginNodeHeaderUrl(42)).toBeNull()
  })
})
