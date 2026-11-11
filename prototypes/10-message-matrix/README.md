# 10 Message Matrix

Prototype of Paper board "10 Message Matrix" (`paper/boards/b10.svg`). The activity is **SIMULATED** (the shared scripted scenario); the shared chrome shows the source badge.

Rows send, columns receive. The same agents sit on both axes in creation order; a row and a column are added the moment an agent spawns.

## What it shows

| Thing | Encoding |
|---|---|
| Task and progress | Header line above the matrix: `TASK · title · NN% · done/total · MESSAGES SO FAR: n`, plus `FINISHED` at the end. |
| Agent state | Diagonal cell glyph and fill: **working** = teal fill with a ring and halo, **waiting** = pale fill, dashed border, dashed ring, **blocked** = amber fill with a pause glyph, **failed** = rust fill with a cross, **done** = dark fill with a check, **queued** = empty outlined cell with a small ring. Attempt > 1 shows `↻n` in the cell corner. |
| Tool call | Small dark chip with the tool name on the working agent's diagonal cell, shown while the call is in flight (`durationMs` + 300 ms of state time). In compact mode it is an 8 px square. |
| Delegation | Solid outline in cell (parent row, child column). Covers spawn and `work_delegated`. |
| Dependency (waiting) | Dashed outline in cell (provider row, waiting column). Strong while the provider is not done, faded once it is done. A cell that is both delegation and dependency shows the solid outline plus an inner dashed outline. |
| Messages | Green fill in cell (sender row, receiver column). Intensity grows with the count (1 = 50%, 5+ = 100%), a number appears for 2+. A new message flashes for 0.8 s; the latest message cell keeps a dark inset outline. Hover shows count, time and the latest text; the "LATEST MSG" pill under the matrix repeats it; the shared inspector lists it in the agent's recent actions. |
| Blocked / failed | Callout pills under the matrix: amber for blocked (reason and what it needs), rust for failed (error, attempt). A teal "recovered on retry" pill stays after a retry. Pills are buttons and select the agent. |
| Outputs | Right-hand OUT column: a page glyph on the producing agent's row, `×n` when more than one. Hover lists the names. |
| Final result | When `task_finished` arrives a RESULT row is added: a page glyph under every agent that contributed an output in `outputIds`, the total in the OUT column, plus a result strip (status and summary) under the matrix. |
| Hover / select | Hovering or selecting an agent (row label, column label, diagonal cell, OUT cell) tints its row and column; everything not in that row or column fades to 55%. Hovering an off-diagonal cell shows the crosshair of its sender row and receiver column. |

## Interaction

- Click, or Enter/Space on a focused row label, column label or diagonal cell, calls `ctx.select(id)` (click again to deselect). Row labels are tab stops; Up/Down moves between them. Clicking a non-empty off-diagonal cell selects its sender.
- Hover or keyboard focus shows a tooltip with the full name, state, tool, or the pair's delegation / waits-for / messages and latest text.
- `?reduced=1` or the shared "Reduce motion" toggle removes the flash and the spawn fade; state changes then appear instantly. There is no continuous animation.

## Run

```bash
node shared/adapter-server.mjs --port 7810
# open http://127.0.0.1:7810/prototypes/10-message-matrix/index.html
# scale check: add ?scenario=stress
```

It also opens straight from disk. Record: `node tools/capture.mjs prototypes/10-message-matrix --select code@10500,test@14500,ship@20000`.

## Scale check (`?scenario=stress`, 30 agents, 1280x800)

- Cells shrink from 32 px to 22 px (the minimum), row labels switch to unique 3-character codes (`AUT`, `AT2`, `BL3`), the full name and state appear in the tooltip. Row labels, the header row and the OUT column are sticky; the matrix scrolls vertically (about 750 px of grid in a 490 px viewport). Horizontally it fits at 1280 px.
- Readable: states, outputs, callouts and the highlight bands. Gets crowded: the tool chip shrinks to a dot, message counts are only shown for 2+ messages, and the codes are generated, so they are less meaningful than the labels (`AT2`, `BL3`). With 30 agents you need to scroll to see the last rows, so a blocker low in the matrix is visible only through its callout pill.

## Known limits

- Rows and columns follow creation order, not the tree, so a subagent's row is not next to its parent (this is the brief; hierarchy is only visible as the solid delegation cells).
- Matrix grows as O(n²) elements; about 900 DOM cells at n = 30 repaint cleanly, but 100+ agents would need canvas or virtualised rows.
- Only one message-intensity scale (saturates at 5). Messages to self and multiple messages in one direction collapse into one cell. Direction is read from the axes, there is no arrow.
- The shared chrome's inspector "Latest activity" list is empty after a seek until the next event; that is shared behaviour.
- Tested in headless Chrome and the in-app browser only.

## Shared issues

- `shared/theme.css` forces `.ac-stage svg { width: 100%; height: 100% }`, which stretches any small inline SVG glyph. Worked around with inline pixel sizes.
- `core.js` has no per-message ids, so two identical messages in the same ms cannot be told apart. Not a problem here.

## What I would change next

- A hierarchy-aware ordering option (children directly under their parent) while keeping the matrix honest.
- A recent-message timeline strip so the order of messages is visible, not only the latest.
- A per-cell history popover (click a cell for the full list of messages and delegations).
