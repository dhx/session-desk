import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { pluginCli } from './plugins.commands.helpers'

test('a plugin creates, renames and recolours a Space that an open canvas shows at once', async () => {
  test.setTimeout(90_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-spaces-plugin-'))
  const userDataDir = await createTestUserDataDir()
  const id = 'spaces-workflow'
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Spaces workflow',
      description: 'Spaces fixture',
      main: 'main.mjs',
      contributes: {
        commands: [
          { id: 'create', title: 'Create', description: 'Create a Space', target: 'plugin' },
          { id: 'rename', title: 'Rename', description: 'Rename a Space', target: 'plugin' },
        ],
      },
    }),
  )
  await writeFile(
    join(source, 'main.mjs'),
    `export function activate({host}){return {async runCommand(command,params){
      if(command==='create'){
        const created=await host.spaces.create({projectId:params.projectId,name:'Client portal',labelColor:'blue'});
        let duplicate='';
        try{await host.spaces.create({projectId:params.projectId,name:'client portal'})}catch(e){duplicate=e.message}
        return {created,duplicate};
      }
      await host.spaces.update({spaceId:params.spaceId,name:'Client portal renamed',labelColor:'green'});
      return host.spaces.list({projectId:params.projectId});
    }}}`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en' } })
    await pluginCli(userDataDir, ['install', source])
    const result = await pluginCli<{
      created: { space: { id: string; name: string; labelColor: string } }
      duplicate: string
    }>(userDataDir, [
      'run',
      id,
      'create',
      '--params',
      JSON.stringify({ projectId: seededWorkspaceId }),
    ])
    expect(result.created.space).toMatchObject({ name: 'Client portal', labelColor: 'blue' })
    expect(result.duplicate).toContain('already has a Space with that name')

    const spaceId = result.created.space.id
    const label = page.getByTestId(`workspace-space-label-${spaceId}`)
    const region = page.getByTestId(`workspace-space-region-${spaceId}`)
    await expect(label).toHaveText('Client portal')
    await expect(region).toHaveAttribute('data-cove-label-color', 'blue')

    const listed = await pluginCli<{ spaces: Array<{ id: string; name: string }> }>(userDataDir, [
      'run',
      id,
      'rename',
      '--params',
      JSON.stringify({ projectId: seededWorkspaceId, spaceId }),
    ])
    expect(listed.spaces).toContainEqual(
      expect.objectContaining({ id: spaceId, name: 'Client portal renamed', labelColor: 'green' }),
    )
    await expect(label).toHaveText('Client portal renamed')
    await expect(region).toHaveAttribute('data-cove-label-color', 'green')
  } finally {
    await electronApp.close()
    await removePathWithRetry(source)
    await removePathWithRetry(userDataDir)
  }
})
