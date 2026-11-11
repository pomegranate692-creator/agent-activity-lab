# 04 Routed Lattice

A circuit board on a dot grid. Agents are **chips** placed left to right by dependency level; everything that moves has an
orthogonal, rounded-corner **wire**. Design reference: Paper board "04 Routed Lattice" (`paper/boards/b04.svg`).
The activity is **simulated** by the shared scenario; the shared chrome shows the source badge and nothing here claims otherwise.

## Run

```bash
node shared/adapter-server.mjs --port 7804
# http://127.0.0.1:7804/prototypes/04-routed-lattice/index.html            (also opens from disk)
# add ?scenario=stress for the 30-agent run, ?t=12000 to start at the all-states moment, ?reduced=1 for reduced motion
node tools/capture.mjs prototypes/04-routed-lattice --select code@10500,test@11500,write@16000,ship@19800
```

Files: `index.html`, `proto.js` (layout, routing, render), `proto.css`. No build step, no external assets.

## Visual encoding

| Thing | Encoding |
|---|---|
| Task and progress | **TASK** terminal at the left edge: fills from the bottom with progress, shows `NN%` and `done/total`. Wired to every root agent. |
| Agent | Rounded chip with a short label. Level = longest chain of parent and `dependsOn` links (column), rows are placed by barycentre of parents and dependencies. Subagents sit one column to the right of their parent, stacked beside its row. |
| working | Teal outline, tinted fill, teal dot with a halo. While a tool call is live the chip gets a stronger teal glow and a **tool pill** under it (`git_log`). The pill lasts for `durationMs` (plus a short tail), computed from `state.t`. |
| waiting | Dashed outline, hollow dashed dot, small `waits: <labels>` note under the chip. |
| queued | Grey outline, hollow dot. |
| blocked | Amber outline and pause glyph, an **amber gate** across the chip's input wires, and an amber **callout** under it (`NEEDS HUMAN APPROVAL`, or the reason). Full reason is in the inspector and the chip tooltip. |
| failed | Rust outline and cross, the incoming wires are **cut** short of the chip with a rust spark, and a rust callout carries the error. |
| retry | Wire is reconnected through a **different channel** (shifted per attempt), glows teal for about 2.6 s, and the chip carries a `RETRY n` tag. |
| done | Dark filled check, solid dark outline. |
| Delegation | Grey **rail** (solid, 2.2 px) from parent or delegator to child. A shared source uses one bus channel, so a parent's rails read as a tree. |
| Dependency | Thin wire from the dependency to the dependent: **dashed** until the dependency is done, **solid** once satisfied. |
| Message | Thick **green wire** from sender to receiver with a **packet** that travels along it (1.3 s of scenario time), a short text pill rides the packet. The wire fades after about 4 s. With an agent selected, its messages from the last 12 s stay visible. |
| Output | **Page glyph** on the producing chip's top-right corner (up to 3, then `+n`). A copy of the glyph flows along a thin teal wire to **RELEASE** at the right edge, where received pages stack. When `task_finished` arrives the terminal fills solid (green on success, rust otherwise) and reads `RELEASED`. |
| Long hops | Edges that skip columns, run backwards, or end at RELEASE travel through lanes above or below the board (interval-packed so they do not overlap). Outputs share one bus lane. |
| Selection | Click, Enter, or Space on a chip calls `ctx.select(id)`. The chip gets a double outline, related chips and wires stay bright, the rest dim to about 50% and 22%. Selecting scrolls the chip into view. Esc or a click on empty board deselects. |

The dot grid, bus lanes and channel spacing are the circuit metaphor; every coloured or dashed mark is derived from state.

## Interaction and accessibility

* Every chip is a focusable `role=button` with an `aria-label` that states name, state, attempt and tool. Tab moves in spawn order. Enter or Space selects. (Space on a chip selects and does **not** toggle play; elsewhere Space still plays or pauses.)
* Reduced motion (OS setting, `?reduced=1`, or the footer toggle): chips jump to their slots, packets and flying pages are not animated (a message shows its wire plus the packet at its destination, outputs count as arrived immediately). No continuous motion exists otherwise: the only animation is chip repositioning (about 100 ms ease) when the layout changes.
* Zoom bar under the board: `-`, `+`, a percentage button (reset to auto), and **Fit** (shrink everything into view). Auto size is clamped to 70-115% so labels stay readable; the board scrolls if it does not fit.
* All visuals are re-derived from `state` on every update (seek, replay and live events behave the same). `?live=` was exercised with the adapter's simulated feed and produced all 12 chips with no errors.

## Scale check (`?scenario=stress`, 30 agents)

* Layout is computed per update from `parentId`, `dependsOn`, delegations and outputs; any number of agents works. With more than 14 agents chips become compact (26 px tall).
* At 1280x800 **Fit** shows the whole 30-agent board at about 72% in a screenshot I inspected (labels about 9 px, legible, pills tight). The auto size shows only part of it and scrolls (content size not measured precisely).
* What gets worse: a tall column of about 9 chips plus many long rails creates a dense mesh of grey and teal lanes at the top and bottom; message pills can cover neighbouring chips; selection is the main way to read it. Output risers for 20 producers form a visible comb along the top.

## Known limits and issues

* Layout jumps when a late agent changes levels. In the scenario `test` depends on `lint`, which spawns at 8.6 s, so `test` first sits in column 1 and slides to column 4 then. It eases when motion is on.
* Rail routing is greedy (no global crossing minimisation); wires cross, and busy gaps show tight 6 px channels.
* A message wire can pass under a chip's callout; text is clipped to 28-34 characters (full text is in the inspector).
* Cycles in `dependsOn` are ignored for levelling (guarded), but would look odd.
* Text sizes are about 9-10 px at the default fit on a 1280 wide window, because 8 columns plus two terminals need about 1290 px. The zoom bar is the workaround.
* Not tested against a real long Claude Code session. Only the shared scenarios (normal, stress) and the adapter's simulated feed were run.
* The shared chrome gives the stage `role="img"` while chips inside are interactive; screen readers may skip them. (Shared issue, not changed.)

## Shared issues

None required. (Noted above: `.ac-stage` has `role="img"`.)

## What I would change next

* Layered crossing minimisation and per-edge ordering of channels, and rounding wire joins with junction dots where branches leave a bus.
* Keep columns stable when a not-yet-spawned dependency is announced (reserve the level from the dependency edge).
* Collapse finished subtrees into one chip at high agent counts, with an expand control.
* Callouts with a leader line and a pinned slot so they never cover neighbours; message text as a popover on hover.
