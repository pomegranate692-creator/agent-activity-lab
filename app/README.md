# The app: Agent Activity Lab command center

One cohesive application. **The primary visualization is the Card tree** (chosen from ten designs; see `docs/DESIGN-REVIEW.md`), refined for live runs. The other designs are kept in `archive/`.

| Part | What it is |
|---|---|
| **Agents** (primary) | `cards/cards.js`: an org chart of status cards. Each card shows state, the current tool and how long it has been running (or the agent's latest commentary), outputs, retries, and an **activity lane** (when this agent was active, from real start/end). Finished subtrees fold, so 1 to 30 agents stay readable. Click or press Enter on a card to inspect it. |
| **Tool stream** | `toolstream.js`: time-ordered tool calls, failures, retries, blocks, messages, commentary and outputs, with filters, an agent picker, and Group by agent. Default view when a run has 1 to 2 agents. |
| **Output** | `runpanel.js`: for a real session, the final answer, generated files (preview and download), denied actions (approve and re-run), duration, tool calls, subagents, cost. Only present with the local service. |
| **Needs You** | blocked and failed agents with their reason, above the views; denied actions get a Review and approve button. |
| Inspector, playback, source badge | the shared shell (`shared/chrome.js`): the badge always says SIMULATED, LIVE · Claude Code session, SAVED · real Claude Code session, REPLAY, or TEST STUB. |
| Command bar | New task, History, status chip, Stop, Retry, Pause (disabled: not supported). Only with the local service. |

## Run

```bash
node server/lab-server.mjs        # real task execution + this app: http://127.0.0.1:7777/app/index.html   (see server/README.md)
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
