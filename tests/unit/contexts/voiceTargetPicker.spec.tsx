import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VoiceTargetPicker } from '../../../src/contexts/voice/presentation/renderer/VoiceTargetPicker'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.boss ? `${key}:${String(options.boss)}` : key,
  }),
}))

const agents = [
  { nodeId: 'a', sessionId: 's-a', title: 'Board', workspaceName: 'Web' },
  { nodeId: 'b', sessionId: 's-b', title: 'Desk', workspaceName: 'App' },
]

describe('VoiceTargetPicker', () => {
  it('shows the agent voice goes to and switches to another one from its menu', async () => {
    const onPick = vi.fn()
    render(
      <VoiceTargetPicker agents={agents} bossNodeId="a" showWorkspace={false} onPick={onPick} />,
    )
    const trigger = screen.getByTestId('voice-target-button')
    expect(trigger.textContent).toBe('Board')
    expect(trigger.getAttribute('aria-label')).toBe('voice.target.buttonLabel:Board')

    fireEvent.click(trigger)
    const current = await screen.findByRole('menuitemcheckbox', { name: 'Board' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    // Only a surface that counts as a menu is placed on screen; a plain one falls below the page.
    expect(screen.getByTestId('voice-target-menu').getAttribute('data-cove-part')).toBe('menu')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Desk' }))

    expect(onPick).toHaveBeenCalledWith('b')
    expect(screen.queryByTestId('voice-target-menu')).toBeNull()
  })

  it('asks for an agent when none is chosen, and names the space when there are several', async () => {
    render(<VoiceTargetPicker agents={agents} bossNodeId={null} showWorkspace onPick={vi.fn()} />)
    const trigger = screen.getByTestId('voice-target-button')
    expect(trigger.textContent).toBe('voice.target.choose')
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Desk · App' })).toBeTruthy()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Board · Web' }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('says to open an agent first when there is none', async () => {
    render(
      <VoiceTargetPicker agents={[]} bossNodeId={null} showWorkspace={false} onPick={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('voice-target-button'))
    const item = await screen.findByRole('menuitem', { name: 'voice.settings.bossNoAgents' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
  })
})
