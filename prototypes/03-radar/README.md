# 03 Radar

Design reference: Paper board "03 Radar" (`paper/boards/b03.svg`). Plain HTML/CSS/JS with SVG; no build step.

## What it shows
- **Rings = delegation depth.** The centre is the orchestrator (the first agent with no parent). Ring 1 holds its direct agents, ring 2 their subagents, and so on. Depth is computed from `parentId`, so any tree shape works.
- **Angle = related work.** Each top-level agent gets a sector sized by its number of leaf agents; subagents sit inside the parent's sector on the next ring. Sectors start at 12 o'clock and run clockwise in spawn order. Faint spokes mark each top-level agent's axis.
- **Outer ring = task progress.** The share of finished agents (`state.progress`) fills clockwise from the top; ticks mark 10 % steps. It completes when the task finishes.

## Encoding
| Thing | Mark |
|---|---|
| working | teal filled blip with a pale halo |
| waiting (dependency open) | dashed outline, pale fill |
| queued | thin mist outline |
| blocked | amber blip with pause glyph + amber callout pill carrying the reason (falls back to "needs X" when the reason is long) |
| failed | rust blip with X + rust callout (`error · RETRY`) |
| retry | blip returns to working with an attempt badge (2, 3 ...) and a short `RETRY n` pill |
| done | ink blip with check |
| recent work | green arc trail behind the blip on its ring; length and opacity shrink linearly over 7 s since the last `tool_called` (no sweep, no decoration) |
| tool call | teal outlined pill with the tool name while the call is in flight (+1.5 s) |
| delegation | straight radial line parent to child (thin at spawn, heavier once `work_delegated`); a handoff between non-parent/child agents is a solid curved chord |
| dependency | dashed curved chord; dark while the dependency is open, faded once it is done |
| message | dotted teal chord for 3.6 s; a dot travels sender to receiver over 1.1 s (position computed from `state.t`, so it also works when scrubbing or paused) |
| output | page glyph beside the blip (up to 3, then +n); tooltip has the name |
| final result | the centre blip turns into a summary badge (status, summary text, output and agent counts) and the outer ring closes |
| selection | click or Enter/Space; selected blip gets a ring, its top-level sector is shaded, its delegation/dependency/message threads are emphasised and the rest dimmed; inspector shows details |

All visuals are derived from `state` (and `state.t`); the prototype never reads `scenario.js` or unplayed events. Layout is computed from the state with eased movement when agents spawn (instant with reduced motion). Esc or a click on empty space deselects.

## Run
```bash
node shared/adapter-server.mjs --port 7803
# http://127.0.0.1:7803/prototypes/03-radar/index.html   (also opens from disk)
# scale check: add ?scenario=stress
node tools/capture.mjs prototypes/03-radar --select code@10500,test@14200
```
Keyboard: Tab moves between blips (spawn order), Enter/Space selects (Space does not toggle playback while a blip is focused). Reduced motion (`?reduced=1` or the footer toggle): no easing, no pop-in, message dots show only at their destination.

## Scale check (`?scenario=stress`, 30 agents)
Still readable at 1280x800: sectors narrow, ring-2 nodes bunch up and are staggered radially by +-15 px when closer than 30 px; all of it fits. Above ~18 agents labels shrink and done agents' labels dim. Breaks or gets crowded: callout pills near the outer ring can overlap the ring or each other (a simple collision pass pushes them apart but cannot always), dependency/message chords pile up near the centre, and ring 1 gets tight beyond roughly 20 top-level agents. Not tested beyond 30.

## Known limits
- Fixed circular canvas, so about a third of the stage width is empty at 1280x800.
- Label placement is a heuristic (outward, or tangential for agents with children); delegation lines can cross labels (labels have a background halo).
- Chords all bow toward the centre, so many dependencies cross there.
- No arrowheads: direction is only readable from the dot on messages and from the inspector.
- The live adapter path was not exercised; only the simulated scenario and the stress scenario were run.
- Not checked in browsers other than headless Chrome.

## Shared issues
None blocking. The shared chrome's stage has `role="img"` yet contains focusable agents (a11y mismatch).

## Next
Arrowheads on dependencies, a time-scrub echo of past trails, collapse of done subtrees for very large runs, pill placement with a real label-avoidance solver, and an elliptical layout to use the wide stage.
