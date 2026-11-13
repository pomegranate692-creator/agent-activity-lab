# The app: Agent Activity Lab command center

One cohesive application. **The primary visualization is the Living Web** (see the Living Web section below). It replaced the Card tree, which won the first round of ten designs (`docs/DESIGN-REVIEW.md`). The other designs are kept in `archive/`.

| Part | What it is |
|---|---|
| **Agents** (primary) | `cards/cards.js`: an org chart of status cards. Each card shows state, the current tool and how long it has been running (or the agent's latest commentary), outputs, retries, and an **activity lane** (when this agent was active, from real start/end). Finished subtrees fold, so 1 to 30 agents stay readable. Click or press Enter on a card to inspect it. |
| **Tool stream** | `toolstream.js`: time-ordered tool calls, failures, retries, blocks, messages, commentary and outputs, with filters, an agent picker, and Group by agent. Default view when a run has 1 to 2 agents. |
| **Output** | `runpanel.js`: for a real session, the final answer, generated files (preview and download), denied actions (approve and re-run), duration, tool calls, subagents, cost. Only present with the local service. |
| **Shared selection** | one selection across views and the inspector: click a card or a Tool stream row, press Enter, or use a Needs You pill. Selecting from the stream opens collapsed ancestors and scrolls the card into view; selecting a card highlights its rows in the stream, scrolls to its latest row, and offers an "Only <agent>" filter. |
| **Per-agent controls** | in the inspector, for real sessions after the run ends: **Retry this agent's work** (failed agents) and **Approve <rule> and continue** (agents blocked on a denied action). Both ask for confirmation, continue the same Claude Code conversation, and start a new linked session (see `server/README.md`). While a run is going they say why they are locked. |
| **Needs You** | blocked and failed agents with their reason, above the views; denied actions get a Review and approve button. |
| Inspector, playback, source badge | the shared shell (`shared/chrome.js`): the badge always says SIMULATED, LIVE · Claude Code session, SAVED · real Claude Code session, REPLAY, or TEST STUB. |
| Command bar | New task, History, status chip, Stop, Retry, Pause (disabled: not supported). Only with the local service. |

## Run

```bash
node server/lab-server.mjs        # real task execution + this app: http://127.0.0.1:47821/app/index.html   (see server/README.md; automatic mode needs no command at all)
node shared/adapter-server.mjs    # demo/simulation only
# or open app/index.html from disk, or visit the GitHub Pages site: DEMO MODE (simulated scenario only)
```
Params: `?scenario=stress` (30 simulated agents), `?t=12000&autoplay=0`, `?reduced=1`, `?live=<adapter url>`. Keys: Space play/pause, R replay, 1 to 4 speed, arrows scrub, Esc deselect, arrows move between cards, Left/Right between tabs.

## How it is built

`collect.js` lets each view register itself; `app.js` mounts ONE shell around them (Needs You strip, tabs, command bar). Views derive everything from accumulated state, so the same code shows simulated, live and saved runs. Nothing in `shared/` or `prototypes/` is needed for the Agents view beyond the shared event model and shell.

## Tests

`node tools/app-test.mjs`: demo mode (tabs, Needs You, click and keyboard selection, 30-agent run, reduced motion) plus the full live flow against the **test stub** (dialog, typing, Run, live updates, Output, History, Retry). Zero page errors required. This does not prove a real Claude Code run (see `server/README.md`).

## Known limits

- With 1 to 2 agents the Agents view is sparse; the shell switches to Tool stream automatically.
- Card activity lanes are relative to the run so far, so they rescale as the run grows.
- Not tested: other browsers, screen readers, touch, windows narrower than about 960 px.
- Shared-shell quirks: the inspector's Latest activity is empty after loading with `?t=` until the next event; the stage has `role="img"`.

## Next

Per-card actions (approve, retry) once mid-run approval is possible; per-agent filtering linked between Agents and Tool stream; concurrent tasks.

## Look (black canvas)

The app overrides the shared mineral tokens at the top of `app.css` (the older prototypes keep `shared/theme.css`).
Background `#050608`, cards `#11151C`, raised `#191F29`, borders `#28313D`, text `#F5F7FA` / `#929BAC`.
Blue `#4DA3FF` = working, violet `#A77BFF` = subagents and delegation lines, mint `#3DE5B3` = done, amber `#FFB84D` = waiting / needs you, coral `#FF6572` = failed.
Motion in the Card tree (`cards/cards.css`, `cards/cards.js`): a card slides out of its parent with a violet ring when the agent is created, the connection carries moving dots while that subagent is working, working cards glow, a mint ring marks completion. Rings fire only for changes seen live, never when a saved record is opened. All of it stops under "Reduce motion" or the system setting.

## Living Web (the main view)

`../shared/livingweb.js` draws the state as one SVG string: Claude Code is the hub, each real subagent is a node around it (diagonal slots up to four, then six, eight, a ring, two staggered rings; nodes shrink so that any number fits without overlap), subagents of subagents sit as small satellites, a curved strand joins each agent to its parent. `web/web.js` puts that drawing on the page, lays a real button over every node, and fills the "Right now" panel. The same renderer runs inside the local service for the pane in the Claude app (`../server/webview.mjs`).
Motion: a node emerges from its parent, the strand lights up on delegation, dots flow while that agent works, a packet runs out on each tool call, a mint packet travels back with a report, a ring marks completion. Every animation is phase-locked to the clock so redrawing never restarts it, and all of it is left out under "Reduce motion" or the system setting.
The older Card tree (`cards/`) is no longer loaded.

Names: a subagent's node, its "Right now" row and its details panel show the job it was given (the real description of the delegation, e.g. "Review server code structure"); its type (e.g. general-purpose) is listed in the details under "Agent type". The task title skips wrapper tags such as `<pasted_content id="...">` and markdown marks and uses the first real line of the prompt.
