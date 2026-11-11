# 06 Floorplan: an office with the plumbing showing

Prototype of Paper board "06 Floorplan". Data is the shared SIMULATED scenario; the shared chrome shows the source badge.

## Run
```bash
node shared/adapter-server.mjs --port 7806
# http://127.0.0.1:7806/prototypes/06-floorplan/index.html   (add ?scenario=stress for 30 agents)
```
Also opens from disk. Preview: `previews/06-floorplan.mp4/.gif/.png`.

## Encoding
- **Rooms** are derived from state, not hard-coded: COMMAND (roots + main agents with no prerequisites), one room per main agent that has subagents (named after it), a leaf main agent fed by exactly one room joins that room, one fed by several rooms starts a new stage room, a leaf main agent nothing depends on goes to the DOCK (which also holds the OUTBOX). Rooms are laid out in a grid chosen by desk count and stage aspect. A room's wall turns amber or rust when it holds a blocked or failed agent.
- **Task progress**: percent plus a thin bar in the COMMAND title.
- **Desk** appears when the agent spawns (pop-in is a function of `state.t - spawnedAt`). Subagent desks are slightly smaller.
- **Working**: teal figure with halo, typing dots on the desk, tool chip (while the tool call is recent). **Waiting**: dashed empty chair plus "waits: X". **Queued**: solid empty chair, "ready". **Blocked**: amber figure with raised hand and an amber callout with the reason. **Failed**: rust x, dashed retry arrow, rust callout with the error. After a retry a small attempt number stays by the chair. **Done**: dark check, tidy desk.
- **Delegation**: thin solid line, drawn in when work is delegated. A spawn-only link is drawn only inside a room (or when the agent is selected).
- **Dependencies**: dashed lines with an arrow toward the dependent; bold while the prerequisite is not done, faint once met.
- **Messages**: dotted green trail per pair (fades with age) and an envelope travelling along it with the text mid-flight.
- **Outputs**: document glyphs pile on the producing desk (glyph marks patch, report, release). On `task_finished` they fly to the OUTBOX, which turns from dashed to solid with the status and summary.
- **Selection**: click or Enter/Space on a desk (all desks are focusable); related desks and lines are highlighted, other lines dim.
- **Reduced motion**: no pop-in, no easing, no typing animation, envelopes rest mid-line, documents land instantly.

## Verification
- Capture tool ran clean (no page errors) at 1280x800. Poster, last frame, stress frame, reduced-motion frame and a 1000x640 frame were inspected.
- Keyboard: Tab to a desk, Enter selects, Space on a desk does not toggle playback; seeking back and forth threw no errors.
- Scale check (`?scenario=stress`, 30 agents, 8 rooms): readable at 1280x800. Desk labels are the 5-char scenario labels, so names are cryptic. Callouts truncate to two lines. Dotted message trails across rooms get busy.

## Known limits
- Below about 1000px stage width the grid falls back to tall narrow rooms and the key can clip.
- Cross-room delegation and dependency lines are straight or curved and pass behind other rooms' desks; they are not routed through corridors.
- The final document flight runs on a wall clock (about 1 s), because the scenario ends at the `task_finished` timestamp. Pausing does not pause it.
- Room membership is re-derived on each update, so a desk can move to another room when later agents spawn; it glides there.
- Room titles are the head agent's name (e.g. "WRITER"), not themed names like the board's "Studio".
- Not tested against the live adapter; not tested with agents whose parent is missing beyond the code path.

## Shared issues
- `scenario.meta.durationMs` equals the `task_finished` time, so nothing can be sim-timed after the result; this prototype uses its own clock for the flight.
- `chrome.js` marks the stage `role="img"`, which hides focusable children from assistive tech.

## Next
Route delegation through room doors and corridors, add inline approve for blocked desks, show full names on hover or at scale, and test live.
