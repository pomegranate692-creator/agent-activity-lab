# 02 Hive Cells

Orchestrator = queen cell at the centre. Main agents take hex slots in an axial spiral (NW, NE, E, SE, SW, W, then ring 2...) in spawn order. Subagents bud as small satellite cells from their parent. A strip of mini hexes at the top (one per agent, plus dashed placeholders for agents not yet spawned) is the task progress. Reference: `paper/boards/b02.svg`. The data is SIMULATED; the shared badge says so.

## Encoding

| Thing | Encoding |
|---|---|
| working | green tint, inner hex ring, ring + pulsing dot (pulse stops under reduced motion) |
| waiting | dashed outline, dotted circle glyph |
| queued | pale cell, solid hollow circle |
| blocked | amber fill, pause glyph, amber callout with the needs and the reason |
| failed | rust fill, crack draws across the cell, X glyph, rust callout with the error; on retry the crack goes, a hex ring pulses out and a `↻n` badge stays |
| done | grey cell, dark outline, check glyph (strip cell dark) |
| delegation | parent-child: solid line (satellites) or a dark "doorway" on the shared edge (adjacent main cells) |
| dependency | dashed line with arrowhead, only while the dependant is waiting on an unfinished agent; all of them for the selection |
| message | dot flying centre to centre with its text; selected agent also gets dotted thread lines to everyone it talked to |
| tool call | mono chip beside the cell while the call is current |
| output | page glyph stacked on the producing cell (+n when more than 4) |
| final result | all cells done, a release cell buds from the queen with a callout and the output count |
| selection | accent halo, related cells get a fainter halo, unrelated ones dim; threads highlight |

Layout is computed from the state only (`computeLayout`): root = first agent without a parent, mains = its children, anything deeper buds. Satellites pick the free direction nearest "outward from the hive". Scale fits the bounding box to the stage and eases as it grows. Faint empty hexes show free slots (hive capacity).

Keyboard: every cell is a focusable button (Tab, Enter or Space selects). Hover or focus shows a tooltip, so labels can be dropped on small cells. Reduced motion: no budding, no pulse, no flight; messages show as a static dotted line and label for 1.6 s.

## Run

```bash
node shared/adapter-server.mjs --port 7802
open http://127.0.0.1:7802/prototypes/02-hive-cells/index.html   # also works from disk
```
Add `?scenario=stress` for 30 agents. Preview: `previews/02-hive-cells.{mp4,gif,png}`, captured from the running page with Researcher, Coder and Tester selected.

## Scale check (30 agents, stress)

Readable. Cells shrink to about half size and the 6 main cells plus 23 satellites fit. Satellite labels are 10 px; short names fit, longer ones go hover-only. Tool chips only show for small cells when hovered or selected. Callouts for blocked or failed stay readable but can sit a little away from their cell. Beyond ~40 agents or many mains the spiral would need a third ring and cells would drop below about 25 px.

## Known limits

- Delegation from the queen to a main cell in ring 2 or more is drawn under the ring-1 cells, so it is mostly hidden (visible when selected).
- Satellite and callout placement is greedy; satellites can glide to a new spot when a later cell (e.g. the release) takes space.
- Message labels in flight can cover a cell's glyph briefly (visible in the poster frame).
- Dependency lines cross cells; with many waiting agents they get busy.
- Tested only in headless Chrome at 1280x800 (and file://); not tested with the live adapter or in other browsers. Reduced motion was only checked for errors, not visually reviewed.

## Shared issues

None needing a change. Note the capture poster at t = 12 s lands mid-flight on a message (test to code), which hides CODE's pause glyph.

## Next

Route delegation lines for ring 2+ over the cells, stable satellite slots reserved at spawn, arrow-key navigation between neighbouring cells, a second ring-aware zoom for 50+ agents.
