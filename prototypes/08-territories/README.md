# 08 Territories

A live Voronoi map of the task. Each main agent owns a region (the Voronoi cell of its seed); subagents are dots inside their owner's region. The orchestrator holds the middle. The data is SIMULATED (the shared chrome shows the badge).

Design reference: Paper board "08 Territories" (`paper/boards/b08.svg`).

## Run

```bash
node shared/adapter-server.mjs --port 7808
# http://127.0.0.1:7808/prototypes/08-territories/index.html          (also opens from disk)
# add ?scenario=stress for 30 agents, ?reduced=1 for reduced motion, ?t=12000&autoplay=0 for the board moment
node tools/capture.mjs prototypes/08-territories --select res@5000,code@10500,test@14000
```

## Encoding

| Thing | Encoding |
|---|---|
| Layout | Seeds derived from state only: orchestrator (first root) in the centre, main agents on elliptical rings in creation order (8, 12, 16... per ring, alternate rings offset). Cells are recomputed every frame by half-plane clipping from the CURRENT seed positions. New seeds are born at the orchestrator and glide out (instant under reduced motion or on scrub). |
| Working / done / blocked / failed | Region tint and border: green / dark grey / amber / rust. Seed body: filled circle + halo (working), check (done), pause (blocked), cross (failed). |
| Waiting / queued | Dashed border, no tint; dashed-outline seed (waiting) or mist outline (queued). Unspawned agents are absent. |
| Subagents | Dots on an arc inside the owner's cell, pulled in if they would leave the cell. Solid thin line to their parent = delegation. |
| Delegation of main work | Faint solid line orchestrator → main; it thickens and darkens for 2.5 s of state time after `work_delegated`. |
| Dependencies | Dashed slate line with an arrowhead at the waiting agent; strong while it waits, 40% once satisfied. |
| Messages | Dotted green line plus a dot travelling sender → receiver (about 1 s); line fades over about 5 s. The words go in a fixed top-left ticker (never over the map). All timing comes from `state.t` and message `t`, so scrubbing works. |
| Tool use | Chip with the tool name under a working seed (beside the dot for subagents). `retry n` shown in rust after a retry. |
| Blocked | Amber pill "NEEDS <what>" plus the reason (2 lines). |
| Failed, then retry | Rust pill "<error> · RETRY"; after `agent_retry` the region turns green and the chip reads `retry 2 · tool`. |
| Outputs | Page glyphs on the seed that produced them (up to 3, then +n). |
| Progress | Corner "MAP CLAIMED n%" (agents done / total, same as the footer) plus a bar and "DONE AREA n%" (share of map area whose owner is done). |
| Final result | On `task_finished` the seeds relax to their cell centres (Lloyd, the map settles), all regions are done, and a summary badge appears where it covers the fewest agents. |
| Interaction | Agents are focusable (Tab; Enter/Space selects without toggling playback). Clicking a region selects its owner. Selection ring, other agents and threads dimmed. Hover or focus shows a tooltip. |

## Scale check

- `?scenario=stress` (1 orchestrator, 6 mains, 23 subagents): readable at 1280x800. Subagent labels, chips and long callouts are hidden when more than 14 agents (shown on hover or selection); blocked and failed show short pills.
- Synthetic 29 mains (plus subs, checked with injected state): regions get small. Above 24 agents the blocked and failed pills are dropped (tint and glyph carry the state; reason on hover), and labels show only for regions with an inner radius of at least 34 px. Still usable.
- Synthetic 60 mains: dense and hard to read; hover is required.

## Known limits

- Region area is geometric, not work volume, so "done area" is only roughly meaningful.
- The Voronoi map is only 2D, so deep hierarchies (depth 3+) are laid out as nested arcs around the owner and get cramped.
- Sub chips can still touch other dots in tight regions. The final-badge placement jumps between spots while seeds are still moving.
- Selection dims everything unrelated (a deliberate choice, but it lowers contrast).
- Verified: no console errors in the main, stress and synthetic runs; keyboard select and region click tested with puppeteer. Not verified: the very last re-recorded preview frame (after moving sub chips beside their dots) was not re-inspected by eye, and a live adapter run was not tried.

## Shared issues

None. Nothing outside this folder and `previews/08-territories.*` was edited.

## Next

Weight cells by workload; draw shared borders once; an animated seed trail on spawn; deal with chip collisions via a label-placement pass.
