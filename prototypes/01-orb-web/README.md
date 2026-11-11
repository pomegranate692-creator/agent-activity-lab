# 01 Orb Web

The task is the hub. Agents hang on threads you can follow. Design reference: `paper/boards/b01.svg` (Paper board "01 Orb Web").
Data is SIMULATED (the shared chrome shows the badge); nothing here implies live work.

## Run

```bash
node shared/adapter-server.mjs --port 7801
open http://127.0.0.1:7801/prototypes/01-orb-web/index.html          # also: ?scenario=stress, ?reduced=1, ?t=12000
open prototypes/01-orb-web/index.html                                   # works from disk too
node tools/capture.mjs prototypes/01-orb-web --select code@10500,test@12600,write@16500
```

Plain HTML/CSS/JS, inline SVG, no build step, no CDN. Files: `index.html`, `proto.js`, `proto.css`.

## Encoding (what you see -> what it means)

| Thing | Encoding |
|---|---|
| Task + progress | Hub ring (grey track, teal arc = done agents / planned agents). Label above: `TASK · 33%`. |
| Hub agent (the single parentless agent, here the Orchestrator) | Centre dot of the hub, state-coloured like any agent, selectable. If there are several parentless agents the hub is the task only and they all become spokes. |
| Main agent | Node on a spoke from the hub (children of the hub agent). |
| Subagent | Node further out, hanging off its parent's node by its own thread (any depth). |
| Delegation / spawn | The thread. On `agent_spawned` it draws out from the parent with easing (900 ms of scenario time), then the node pops in. |
| Dependency (waiting) | Dashed slate arc with a hollow node at its middle and an arrowhead pointing at the dependent. When the dependency is done the arc turns solid with a ticked middle (it flashes teal for 0.9 s when that happens). |
| Message | Teal dotted arc between the two agents, a bead travels sender -> receiver (1.5 s), text shows beside the bead, arc fades after ~4 s. Selecting an agent keeps its past message arcs visible. |
| Tool call | Two teal pulses run along the agent's thread, a ring ripples at the node on arrival, and a tool chip (tool name) sits by the node while the call is in flight. |
| Working | Teal node with halo, thread turns teal. |
| Waiting / queued | Dotted ring (waiting) / plain mist ring (queued), thread greyed. |
| Blocked | Amber node with pause glyph and halo, an amber knot on the thread (thread past the knot is amber), amber callout with the reason text. |
| Failed | Rust node with x, the thread snaps (a gap opens at 58 %) and fades, rust pill with the error. |
| Retry | The thread re-spins: the gap closes in teal over 0.9 s, a teal "RETRY · ATTEMPT n" pill shows for 2.6 s, `×n` stays by the node. |
| Done | Ink node with check. |
| Output | Page glyph attached beside the producing agent (kind changes the lines inside: doc, patch `+`, report bars, release is filled). Name tag appears for ~2 s, and on hover or selection. |
| Final result | Ring completes (and a single ring pulse leaves the hub), `TASK · DONE`, and the release node (a diamond socket on the hub ring, labelled `RESULT` while empty) lights up and is labelled with the release output. |
| Depth | The faint web rings are delegation levels (spokes level 1, subagents level 2, ...). |

A small key in the stage's bottom-left repeats this.

## How the layout is computed (any number of agents)

- Hub agent = the only parentless agent (else the hub is just the task). Main agents are its children.
- Each main agent gets an angular sector proportional to `leaves^0.7` of its subtree; first spoke starts at 12 o'clock and goes clockwise in spawn order. Descendants split their parent's sector (capped fan), so subagents spread around the parent's thread direction.
- Radius per depth level fits the stage (elliptical, uses the whole width); minimum separation from the hub is enforced.
- Positions ease to their new targets when agents spawn; they snap under reduced motion.
- The release socket sits in the widest angular gap between spokes (away from the top/bottom where the labels are).

Time-based visuals are functions of `state.t` (spawn, beads, pulses, snap/mend, flashes), so scrubbing, pausing, 4x speed and the deterministic capture all show the same frames. Only position easing and the progress arc use wall-clock smoothing.

## Interaction and accessibility

- Every agent (and the hub agent) is a focusable `button` in the SVG; Enter/Space calls `ctx.select(id)` (the handler stops propagation so Space does not also toggle playback). Tab order = spawn order. Visible focus ring. Native `<title>` tooltips.
- Selecting highlights the agent, its ancestors' threads, its children, dependency neighbours and message partners; everything else dims to ~30 %. Esc deselects (shared chrome).
- Reduced motion (OS setting or the shared toggle): threads appear fully drawn, no pulses/ripples/bead travel or position easing; failed threads show already snapped; messages show a static arc with the bead at the receiver for ~3 s.
- The stage `role` is set to `group` instead of `img` (the shared chrome sets `img`, which would hide the focusable children from assistive tech).

## Scale check (`?scenario=stress`, 30 agents, 6 groups of 3-5 subagents)

Works, but it is the busiest picture of the set: layout, threads, states and callouts stay correct, no console errors.
- Dense mode (> 16 agents): smaller nodes and rings (x0.62-0.74), labels only for main agents, problem states (blocked/failed), hovered, focused or selected agents; subagent names come from hover or the inspector. Dependency arcs and mid markers fade to 35 % unless selected.
- What gets hard: the 24 outer subagents sit close together at 1280x800 (about 60-80 px apart), their output pages and name tags crowd each other; several simultaneous dotted message arcs plus waiting arcs cross the web and the hub, so tracing one pair needs a selection; blocked callouts for outer agents get clamped to the stage edge and can sit away from their node. Beyond roughly 40 agents the outer ring would need smaller glyphs or clustering.

## Known limits

- Only the latest tool call per agent is kept by the reducer, so earlier tool pulses are lost when two calls are close together.
- Failure timing (snap, mend) is read from `agent.recent` (last 12 entries); an agent with more than 12 later actions after failing would lose the animation timing and show the plain failed style.
- Threads are straight; sibling output pages and labels can collide on tight sectors (stress), and the message text tag can overlap a nearby pill for a moment.
- The release node assumes one hub; with several parentless agents it still works but the hub agent is not selectable.
- Not tested: more than two delegation depths, touch input, browsers other than Chrome. The live adapter path was exercised only with the simulated feed (`POST /sim`), no real Claude Code hook stream.

## Shared issues (not changed, worked around)

- `shared/chrome.js` sets `role="img"` on the stage, which hides focusable children; the prototype overrides it with `role="group"` on its own stage element.
- `AgentCore.util.topLevel` hard-codes the id `orch`; not used here (layout is derived from parent links instead).
- Agent state has no `failedAt` / `retryAt`; the prototype finds them in `agent.recent`. Explicit timestamps in the reducer would be more robust.

## What I would change next

- Cluster or collapse subagent groups past ~25 agents (expand on select) instead of showing all of them.
- Route dependency arcs around the hub and bundle them when many share an endpoint.
- Put the unmet-dependency reason in the arc itself (hover shows "waiting for Linter").
- Keep a short per-agent tool history (last N calls as faded ticks along the thread) so heavy tool use reads as density, not just the latest pulse.
