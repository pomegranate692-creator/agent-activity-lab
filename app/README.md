# Unified viewer v0

One shell that combines the three recommended designs plus a new view for the most common real case.

| Tab | What it is | Code |
|---|---|---|
| Cards (default for 3+ agents) | Card tree: who is doing what, folds finished work | `prototypes/09-card-tree/proto.js`, unchanged |
| Timeline | Swimlanes: when things happened, who waited on whom | `prototypes/07-swimlanes/proto.js`, unchanged |
| Result | Contribution river: how every agent fed the outcome. Greyed out until there are outputs or the task finished | `prototypes/05-contribution-river/proto.js`, unchanged |
| All ten as one | NEW. ALL ten designs merged into one picture as toggleable layers (see below) | `composite.js` |
| Tool stream (default for 1 to 2 agents) | NEW. Time-ordered list of tool calls, failures, retries, blocks, messages, outputs. Built because a real Claude Code session is mostly one agent making sequential tool calls | `toolstream.js` |

Tool stream has filter chips (All, Problems, Tool calls, Messages & handoffs), an agent picker, and a Group by agent toggle for runs with several agents.

Above the tabs, a **Needs you** strip lists every blocked agent (with its reason) and every failed agent (with its error). Click a pill to select that agent. Selection, playback and speed are shared across all tabs and the inspector on the right.

## All ten as one picture

`app/one.html` (also a tab here) is a single radial map where every earlier design is a layer you can toggle, with the layer number matching the design:

| Layer | Design | What it draws |
|---|---|---|
| 01 | Orb web | hub with task progress, delegation threads, message beads in flight |
| 02 | Hive cells | subagents bud off their parent as hexagons |
| 03 | Radar | rings = delegation depth |
| 04 | Routed lattice | dependencies as traces: out along a spoke, around a ring, back in (dashed = still waiting) |
| 05 | Contribution river | ribbons into the hub; width = time since the agent started (not pure work time); amber tick = blocked |
| 06 | Floorplan | each main agent's wedge is a room with walls and a name plate (amber/rust walls when something inside is blocked/failed) |
| 07 | Swimlanes | outer ring is the time axis with blocked/failed/output ticks and a NOW needle; every card has a mini lane |
| 08 | Territories | each room is tinted by its worst state |
| 09 | Card tree | main agents are status cards (state text, current tool, outputs) |
| 10 | Message matrix | inset grid, row sends and column receives |

Derived from state only, so it works on live and replayed events. Tested on the simulated run (12 s and final), the 30-agent stress run, click and keyboard selection, layer toggles, and real-time playback with zero page errors. Limits: with 1 to 2 agents it is nearly empty (use Tool stream); labels are truncated at scale; ribbon width is elapsed time, not effort; it does not group by dependency like the lattice does; the matrix inset hides above 30 agents. `app/all.html` is the other take: a live tile grid of the ten original designs.

## Live mode

With `?live=<adapter url>` and no events yet, the page shows a "Waiting for events" screen with the exact connect steps and the badge reads CONNECTED · WAITING FOR EVENTS (not SIMULATED). Tool stream bars use measured durations when the source reports them (`tool_returned`; real in transcript replays, expected from hook events but unverified), otherwise time until the next action.

## Run

```bash
node shared/adapter-server.mjs          # http://127.0.0.1:7777/app/index.html
# or open app/index.html straight from disk
```
URL params as for every prototype: `?scenario=stress`, `?t=12000&autoplay=0`, `?reduced=1`, `?live=http://127.0.0.1:7777`. Left/Right arrows move between tabs when a tab has focus.

Replay a REAL recorded Claude Code session (badge reads REPLAY · transcript):
```bash
node tools/transcript-to-events.mjs <transcript.jsonl> --out replay.json
curl -X POST 'http://127.0.0.1:7777/replay?speed=8' -H 'content-type: application/json' --data-binary @replay.json
open 'http://127.0.0.1:7777/app/index.html?live=http://127.0.0.1:7777'
```

## How it is built

`collect.js` swaps `AgentChrome.mount` for a collector, so each existing prototype registers its `create()` as a view. `app.js` then mounts ONE shared chrome (header, source badge, inspector, controls) whose stage hosts all four views, stacked, with only one visible. All views keep receiving updates, so switching tabs never loses state. Nothing in `shared/` or the existing prototypes was edited, and the shared source badge cannot be hidden.

## Verified (headless Chrome 1280x800, zero page errors)

- Simulated scenario at 12 s and at the end, all four tabs, screenshots read by eye.
- `?scenario=stress` (30 agents) on Cards and Timeline; `?reduced=1` loads and the clock advances.
- Real replay of 80 recorded tool calls: one agent, so Tool stream was chosen automatically, badge REPLAY · transcript.
- Keyboard: tab arrows, Enter on a Tool stream row selects its agent, Esc deselects. Selection persists across tabs. The Needs-you pill selects the agent. Result is disabled with a reason at t = 0.
- Preview: `previews/11-unified-app.{mp4,gif,png}` (view switch and agent selection during the clip).

## Known limits

- Tool stream reads `state.log` (the reducer keeps the last 200 lines). Bar length is the measured duration when the source reports one (transcript replays do; hook events should but are unverified), otherwise the time until the next recorded action.
- In a replay, transcripts do not record permission waits, messages or outputs, so Needs you stays empty and Result stays disabled. Real hook events could fill these, but tool-level hook payloads are not yet verified (see `shared/README.md`).
- Result view is the river as built: unspawned dependencies have no edge until the agent appears, so columns can shift.
- Stress run: Cards needs vertical scrolling; labels are truncated ids (`REE1`).
- Not tested: other browsers, screen readers, touch, narrow windows (the shared shell is designed for 960 px and up).
- Tool stream filters and grouping were tested on the 30-agent stress run (counts per filter, agent picker, 28 groups); the log window still holds only the last 200 lines, so older agents drop out of a long run.

## Shared issues (worked around, not changed)

- The shared inspector's "Latest activity" list stays empty when you load with `?t=` and `autoplay=0` until the next event.
- `shared/chrome.js` gives the stage `role="img"`, which hides the focusable children from assistive tech.

## Next

Approve/retry actions on Needs-you pills (only after read-only use is trusted); verify tool-level hook payloads from a real session; run it alongside a live session as a persistent window.
