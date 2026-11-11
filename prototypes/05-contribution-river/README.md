# 05 Contribution River

Sankey-style flow answering "how did everything feed the result". Design reference: `paper/boards/b05.svg`. SIMULATED data (shared chrome shows the badge).

## What it shows
- **Agents** = vertical bars. Columns = topological levels of the contribution graph, computed from state: `dependsOn` edges, "a subagent feeds its parent", and "a subagent inherits its parent's inputs"; edges implied by a longer path are dropped. Parentless agents with no dependency edges (the coordinator) are a chip top right, not a bar.
- **Thickness = effort so far** (working time up to now, blocked/failed time excluded, derived from `state.log`/`startedAt`). Grows live. Not-yet-started agents get a fixed 24 px dashed placeholder, never a predicted size.
- **Ribbons** = contributions; colour/style from the source agent: working = teal + flowing dashes, done = grey, blocked = amber, failed = rust, waiting/queued = dashed channel. Agents with no downstream agent feed RELEASE directly (softer ribbon).
- **Blocked** = amber hatched dam on the ribbon + callout (reason, needs). **Failed** = rust eddy + callout; **retry** = flow resumes, a ring expands, label shows `↻N`.
- **Tool use** = pill on the ribbon (last tool, shown while working). **Delegation** = brief `▸ assigned: …` flag. **Messages** = brief dotted tick between the two bars with a text chip (~2.6 s sim time).
- **Outputs** = page pebbles dropped on the producer's ribbon and carried downstream into the RELEASE channel, which fills with delivered effort (an agent counts once done and all its pebbles arrived).
- **Task progress** = header: percent of agents done + delivered-effort bar (delivered / spent so far).
- Select: click, Enter or Space on a bar or the coordinator chip; related ribbons stay bright, others dim.

## Run
```
node shared/adapter-server.mjs --port 7805
open http://127.0.0.1:7805/prototypes/05-contribution-river/index.html   # or ?scenario=stress, ?reduced=1, ?live=...
```
Also opens from disk. Checked with the live adapter (`POST /sim`): same picture as the simulated source.

## Scale check (`?scenario=stress`, 30 agents)
Readable at 1280x800: compact mode (smaller labels, no effort text, 16 px minimum bars). Tool pills, message chips and delegation flags overlap neighbours when many are active at once; labels are short ids (e.g. `BIL3`).

## Reduced motion
Tween, flow dashes, eddy spin and rings are off; pebbles are not carried (they appear in RELEASE immediately, so delivered = produced).

## Known limits
- Layout reflects only what is known so far: a dependency on a not-yet-spawned agent has no edge (TEST sits in column 0 with a long dashed ribbon until LINT spawns). When LINT spawns, CODE shifts a column (tweened). The graph differs slightly from the Paper board because the "subagent feeds parent" rule puts LINT before CODE.
- A long code-to-RELEASE ribbon crosses the middle of the river.
- Effort is rebuilt from `state.log` (last 200 lines); very long runs may lose old blocked intervals.
- Verified in headless Chrome and the in-app browser; not tested in Safari/Firefox.
- Root agent effort is not counted in totals.

## Shared issues
None required. (`chrome.js` does not give prototypes a hook for dimming the inspector; not needed.)

## Next
Show delegation as thin ribbons from the coordinator; collapse subagent groups at scale; a stub for dependencies on unspawned agents.
