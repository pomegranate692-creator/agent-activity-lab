# 09 Card Tree

Delegation as an org chart whose cards read like a status report. Design reference: Paper board "09 Card Tree" (`paper/boards/b09.svg`). The data is SIMULATED; the shared chrome badge says so.

## What it shows
Root (Orchestrator) at the left, one column per depth. Subagent cards slide out from their parent when spawned. Layout is computed from parent/dependency state (tidy tree, parent centred on its children), not from the 12 scenario ids.

| Thing | Encoding |
|---|---|
| working | teal card and strip, filled dot with halo; line shows the current tool (`pytest · attempt 2`), or `delegating` / `collecting results` for parents; thin sliver at the bottom = elapsed share of the tool's `durationMs` |
| waiting | dashed card, empty dashed dot, `waits for <unmet dependencies>` |
| blocked | amber card, pause glyph, the reason in words (up to 2 lines) |
| failed | rust card, x glyph, error text; after `agent_retry` the card turns teal again and keeps a rust `↻N` badge |
| done | ink strip, check glyph, `done` |
| delegation | elbow lines parent to child; an elbow turns teal for 1.6 s after `work_delegated` |
| dependency | dashed arcs in the right gutter with an arrowhead at the dependent; faded once satisfied |
| message | dotted green arc (sender to receiver), a pulse travels along it on arrival, a label pill shows for 2.6 s |
| tool use | status line + progress sliver |
| outputs | chip on the producing card (icon by kind; name, or `×N` for several). A folded parent shows its whole subtree's outputs |
| progress | `TASK · NN%` bar and counts around the root card; each parent's chevron shows `done/total` agents inside |
| collapse | chevron per parent. Finished subtrees fold 1.5 s after the last agent in them is done (never the root, never a subtree containing the selected agent). A click pins open or closed. A folded card is stacked and shows the worst child state glyph |
| result | RESULT card under the tree when `task_finished` arrives: status, summary, one chip per output (click selects the producing agent). The stage scrolls to it |

Selection: click, Enter or Space on a card (Up/Down move between cards; Tab reaches cards and chevrons). Selected card gets a ring, its path to the root goes dark, its dependency and message arcs stay bright and all other arcs dim; cards linked to it by dependency or message get a thin outline. Reduced motion: no slide-in, no pulses, instant scroll.

## Run
```bash
node shared/adapter-server.mjs --port 7809
open http://127.0.0.1:7809/prototypes/09-card-tree/index.html          # also ?scenario=stress
node tools/capture.mjs prototypes/09-card-tree --select code@10500,test@12600,res@14800
```
Also opens from disk. Checked with the adapter bus (`POST /sim?speed=4` with `?live=...`): 12 cards, RESULT card appears, no console errors.

## Scale check (`?scenario=stress`, 30 agents)
Works. Unfolded it is 1400 px tall (scroll the stage; new spawns scroll into view unless you scrolled in the last 6 s). Folding finished subtrees brings it down to about 8 cards plus RESULT by the end. Weak spots: while many subtrees run at once you must scroll to see all of them; the gutter arcs of 5 to 6 sibling dependencies bunch up; a `queued` parent whose children already run still says "queued, ready" (the state model has no "delegating" state for it).

## Known limits
- Message label pills are drawn above the cards and can cover part of a neighbouring card for 2.6 s.
- Arcs between different columns run behind intermediate cards.
- Waiting text uses agent names ("waits for researcher, tester"), not the board's short labels, because labels are not reliable (stress labels are truncated names). Long names wrap to two lines.
- Tested on desktop width only (stage 960 px at 1280x800); not tuned for narrow screens.
- Verified by headless Chrome and screenshots; keyboard checked with a puppeteer script (Enter, Space, Up/Down, chevron). No screen reader pass.

## Shared issues
None blocking. The shared inspector's "Latest activity" list is empty after the task finishes with nothing selected (chrome only re-renders it on events).

## Next
Collapse animation; a "follow activity" toggle; place message labels in free space with a leader line; filter chips (only blocked/failed).
