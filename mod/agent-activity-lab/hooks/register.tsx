/*
 * Agent Activity Lab: the Living Web as a pane beside the chat.
 *
 * This mod draws nothing of its own. The local Agent Activity Lab service on this Mac (127.0.0.1 only) already records the real hook events of
 * every Claude Code session; this pane asks it for the picture of THIS session's newest task (GET /api/web) and shows it. It sends nothing
 * anywhere else, changes no tool call and no prompt, and stores nothing.
 *
 * Desktop app: when you submit a task, the FULL dashboard (the local page http://127.0.0.1:<port>/app/index.html) is opened in the app's own
 *   browser pane, beside the chat, unless it is already open there. Nothing else is ever opened or navigated.
 * Where there is no browser pane (a terminal session), or it cannot be opened: this mod's own small pane, with the web as an image on
 *   surfaces that can draw one and a "who is doing what" list as text.
 *
 * /living-web opens the small pane by hand. Each attempt to open the dashboard writes one line to ~/.agent-activity-lab/mod.log.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WebView } from '../types'

const PANE = 'living-web'
const TITLE = 'Agent Activity Lab'
const EMPTY: WebView = { link: 'starting', rev: '', status: 'idle', title: '', svg: '', alt: '', agents: [] }
const view = atom({ plugin: 'agent-activity-lab', key: 'view' } as const, EMPTY, { shape: 'view-1' })

let token = ''
let port = 47821
let isBusy = false
let isClosedByPerson = false
let isShowing = false

async function connect($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  token = (await $.fs.read(`${home}/.agent-activity-lab/token`)).trim()
  try {
    const config = JSON.parse(await $.fs.read(`${home}/.agent-activity-lab/config.json`)) as { port?: unknown }
    if (typeof config.port === 'number') port = config.port
  } catch {
    // no config file: the default port stands
  }
}

async function refresh($: EngineInterface): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    if (!token) await connect($)
    const id = await $.session.id()
    const answer = await $.http.fetch(`http://127.0.0.1:${port}/api/web?session=${encodeURIComponent(id)}&w=680&h=600`, {
      headers: { 'x-lab-token': token },
    })
    if (!answer.ok) throw new Error(`service answered ${answer.status}`)
    const next = JSON.parse(answer.text) as Omit<WebView, 'link'>
    await update($, view, old =>
      old.link === 'live' && old.rev === next.rev
        ? old
        : { link: 'live', rev: next.rev, status: next.status, title: next.title, svg: next.svg, alt: next.alt, agents: next.agents },
    )
  } catch {
    token = ''
    await update($, view, old => (old.link === 'offline' ? old : { ...EMPTY, link: 'offline' }))
  } finally {
    isBusy = false
  }
}

const BROWSER = 'Claude_Browser' // the desktop app's built-in browser pane, as its tools are named (mcp__Claude_Browser__...)
const VIEW = 'ccd_view' // the desktop app's own "show this pane" tool (mcp__ccd_view__show_pane)

function words(result: { content: { text?: string }[] }): string {
  return result.content.map(block => block.text ?? '').join(' ')
}

/**
 * Puts the full dashboard in front of the person: makes sure a tab of the app's browser pane holds it (opening one only if none does),
 * then asks the app to SHOW that pane, since a tab opened from here stays hidden otherwise. True when the pane is shown.
 */
async function showDashboard($: EngineInterface): Promise<boolean> {
  let outcome = 'unavailable'
  let isShown = false
  try {
    if (!token) await connect($)
    const tabs = await $.mcp.call(BROWSER, 'tabs_context')
    const listed = words(tabs)
    let hasTab = !tabs.isError && listed.includes(`127.0.0.1:${port}`)
    outcome = tabs.isError ? `tabs_context refused: ${listed.slice(0, 120)}` : hasTab ? 'tab already there' : 'no tab yet'
    if (!tabs.isError && !hasTab) {
      const opened = await $.mcp.call(BROWSER, 'preview_start', { url: `http://127.0.0.1:${port}/app/index.html` })
      hasTab = !opened.isError
      outcome = hasTab ? 'tab opened' : `preview_start refused: ${words(opened).slice(0, 120)}`
    }
    if (hasTab) {
      const shown = await $.mcp.call(VIEW, 'show_pane', { pane: 'preview' })
      isShown = !shown.isError && /showing/i.test(words(shown))
      outcome += isShown ? ', pane shown' : `, show_pane answered: ${words(shown).slice(0, 120)}`
    }
  } catch (error) {
    outcome += ` (${error instanceof Error ? error.message.slice(0, 140) : 'call failed'})`
  }
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const file = `${home}/.agent-activity-lab/mod.log`
    let earlier = ''
    try {
      earlier = (await $.fs.read(file)).split('\n').filter(Boolean).slice(-30).join('\n') + '\n'
    } catch {
      // first line of a new log
    }
    const session = (await $.session.id()).slice(0, 8)
    await $.fs.write(file, `${earlier}${new Date(await $.clock.now()).toISOString()} session ${session} dashboard in the browser pane: ${outcome}\n`)
  } catch {
    // the log is a convenience
  }

  return isShown
}

const MARK: Record<string, string> = { working: '●', done: '✓', failed: '✕', blocked: '!', waiting: '◌', queued: '○' }
const COLOR: Record<string, string> = { blue: '#4DA3FF', violet: '#A77BFF', mint: '#3DE5B3', amber: '#FFB84D', coral: '#FF6572', grey: '#929BAC' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'living-web', description: 'Show the small Agent Activity Lab pane (your agents as a living web)' })
    void refresh($)
    $.clock.every(2000, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'living-web' }, async $ => {
    isClosedByPerson = false
    await $.ui.open({ id: PANE, title: TITLE, backgroundColor: '#050608' })
    void refresh($)

    return { text: 'Agent Activity Lab pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') isClosedByPerson = true

    return next(e)
  }).catch((_, e, next) => next(e))

  // A task is starting. The settings hooks beneath (`next`) have just told the local service, starting it if needed, so the page can load:
  // show the full dashboard in the app's browser pane; only where that is not possible, this mod's own small pane.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (!isShowing) {
      isShowing = true // one attempt at a time, so two quick prompts never open two tabs
      void showDashboard($)
        .then(isShown => {
          if (!isShown && !isClosedByPerson) void $.ui.open({ id: PANE, title: TITLE, backgroundColor: '#050608' })
        })
        .finally(() => {
          isShowing = false
        })
    }
    void refresh($)

    return result
  })
  on('classic.PreToolUse', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const now = await read($, view)

    if (now.link === 'offline')
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Agent Activity Lab is not running</Text>
          <Text dimColor>The local service starts by itself at your next prompt. Check it with: node ~/agent-activity-lab/tools/lab.mjs doctor</Text>
        </Box>
      )

    const rows = now.agents.slice(0, 16).map(agent => (
      <Box flexDirection="row" gap={1}>
        <Text color={COLOR[agent.tone] ?? '#929BAC'}>{MARK[agent.state] ?? '○'}</Text>
        <Text bold={agent.main}>{agent.name}</Text>
        <Text dimColor wrap="truncate-end">
          {agent.text}
        </Text>
      </Box>
    ))
    const heading =
      now.agents.length === 0 ? (
        <Text dimColor>Waiting for a task. Give Claude Code something to do and your agents appear here.</Text>
      ) : (
        <Text bold wrap="truncate-end">
          {now.title || 'Current task'}
        </Text>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {/* drawn as an image, so it scales to the pane's width; its CSS animations still run. (As an interactive frame it fell back to a tiny default size.) */}
        {'Svg' in table && now.svg !== '' && <table.Svg source={now.svg} alt={now.alt} />}
        {heading}
        <Box flexDirection="column">{rows}</Box>
      </Box>
    )
  })
}
