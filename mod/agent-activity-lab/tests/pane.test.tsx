import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-activity-lab',
  component: 'Pane',
  requestId: 'living-web',
  props: { title: 'Agent Activity Lab', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const ANSWER = {
  ok: true, found: true, id: 't1', status: 'running', title: 'Review the server', rev: 't1:9:running',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>', alt: 'Task: Review the server.',
  agents: [
    { name: 'Claude Code', state: 'working', tone: 'blue', text: 'Coordinating agents', main: true },
    { name: 'Explore', state: 'working', tone: 'blue', text: 'Reading observer.mjs', main: false },
  ],
}

test('the pane shows what the local service drew, on the desktop and in the terminal', async ($, on) => {
  on('command.register', () => ({ value: { command: 'living-web' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.read', () => ({ value: 'test-token' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.every', () => ({ value: {} }))
  on('http.fetch', (_, e) => {
    expect(e.url).toContain('http://127.0.0.1:47821/api/web?session=session-1')

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(ANSWER) } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'living-web', args: '' })

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  expect((await desktop.find({ type: 'Text', text: /Reading observer/ }))?.text).toBe('Reading observer.mjs')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /Coordinating agents/ })).toBeDefined()
  await terminal.unmount()
})

test('a task opens the full dashboard in one browser tab and shows that pane every time; the small pane only where there is no browser', async ($, on) => {
  const calls: string[] = []
  const panes: string[] = []
  let hasBrowser = true
  let isOpenThere = false
  on('command.register', () => ({ value: { command: 'living-web' } }))
  on('ui.open', (_, e) => {
    panes.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.read', (_, e) => (String(e.path).endsWith('mod.log') ? { value: '' } : { value: 'test-token' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('session.id', () => ({ value: 'session-1' }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(ANSWER) } }))
  on('classic.UserPromptSubmit', () => ({}))
  on('mcp.call', (_, e) => {
    if (!hasBrowser) throw new Error('no such server')
    calls.push(`${e.server}.${e.tool}`)
    if (e.server === 'ccd_view') return { value: { content: [{ type: 'text', text: 'Showing the preview pane.' }], isError: false } }
    if (e.tool === 'tabs_context') return { value: { content: [{ type: 'text', text: isOpenThere ? 'tabs: http://127.0.0.1:47821' : 'browserOpen false' }], isError: false } }
    isOpenThere = true
    expect(e.args?.url).toBe('http://127.0.0.1:47821/app/index.html')

    return { value: { content: [{ type: 'text', text: 'Browser pane opened.' }], isError: false } }
  })
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'do a thing', session_id: 'session-1', transcript_path: '/t', cwd: '/' } as const

  await $.classic.UserPromptSubmit(prompt)
  await new Promise(resolve => setTimeout(resolve, 30))
  await $.classic.UserPromptSubmit(prompt)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(calls).toEqual(['Claude_Browser.tabs_context', 'Claude_Browser.preview_start', 'ccd_view.show_pane', 'Claude_Browser.tabs_context', 'ccd_view.show_pane'])
  expect(panes).toEqual([])

  hasBrowser = false
  await $.classic.UserPromptSubmit(prompt)
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(panes).toEqual(['living-web'])
})

test('when the service does not answer, the pane says so', async ($, on) => {
  on('command.register', () => ({ value: { command: 'living-web' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.read', () => ({ value: 'test-token' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))

  await $.command.run({ command: 'living-web', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /not running/ })).toBeDefined()
  await ui.unmount()
})
