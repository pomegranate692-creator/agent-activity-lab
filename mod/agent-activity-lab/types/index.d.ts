export type WebAgent = { name: string; state: string; tone: string; text: string; main: boolean }

/** What the pane draws: the newest task of this Claude Code session, as the local service drew it. */
export type WebView = {
  /** `live` once the service answered; `offline` when it did not; `starting` before the first try. */
  link: 'starting' | 'live' | 'offline'
  rev: string
  status: string
  title: string
  svg: string
  alt: string
  agents: WebAgent[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-activity-lab': { view: Shaped<WebView> }
  }
}
