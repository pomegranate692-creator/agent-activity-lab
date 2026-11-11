# Comparison of the ten concepts (2026-11-10)

All ten ran the same simulated scenario ("Ship the v2.3 release notes", 12 agents, 21.6 s) and the same 30-agent stress scenario. 

**How to read the scores.** They are my judgment from: the t = 12 s poster of every prototype, the final-state frame, the stress frames (regenerate with `node tools/qa.mjs`), each prototype's README, and code size. No user has tried them on real work, so "usefulness" is an informed guess, not a measurement. 5 is best; for effort, 5 means cheapest to build and maintain.

## Objective checks (`node tools/qa.mjs`, headless Chrome 1280x800)

| Check | Result for all ten |
|---|---|
| Page errors (normal, reduced motion, stress) | none |
| Task reaches `task_finished`, 12 of 12 agents done | yes |
| Clock advances with `?reduced=1` | yes (07's session had reported a stall in the in-app browser pane; I could not reproduce it in headless Chrome, so it was most likely a pane artifact, but not proven) |
| Stress scenario loads with 30 agents | yes |
| Agents reachable by keyboard | yes (12 to 37 focusable elements each) |

Not checked by anyone: the live adapter with a real Claude Code session, browsers other than Chrome, screen readers, touch.

## Scores

| # | Concept | Clarity | Appeal | Real-task use | Scale (30 agents) | Effort | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Orb web | 3 | 5 | 3 | 2 | 4 | Most striking. At 30 agents the outer ring crowds, arcs cross, callouts drift from their nodes. |
| 02 | Hive cells | 3 | 4 | 2 | 3 | 3 | Adjacency means nothing in real tasks; delegation lines to outer rings hide under cells. |
| 03 | Radar | 4 | 4 | 3 | 3 | 5 | Depth rings are honest and simple. About a third of the stage is empty; chords pile up. Smallest code. |
| 04 | Routed lattice | 3 | 3 | 4 | 3 | 3 | Every edge is explicit, so it explains dependencies best. Text is 9 to 10 px at fit; layout jumps when a late agent changes levels. |
| 05 | Contribution river | 4 | 5 | 4 | 3 | 3 | Only concept answering "how did everything feed the result". Long cross-river ribbons; labels turn into generated ids at scale. |
| 06 | Floorplan | 4 | 4 | 3 | 3 | 3 | Friendly, rooms group work well. Long cross-room lines cut across desks; the closest relative of the popular GitHub "office" family. |
| 07 | Swimlanes | 5 | 3 | 5 | 4 | 3 | Time, order, waiting, blockers and tool history in one view. Less eye-catching; long runs need pan/zoom; handoff bundles get dense. |
| 08 | Territories | 3 | 4 | 2 | 3 | 3 | Region area is geometric, not workload, so it says little. Falls apart past roughly 60 mains. |
| 09 | Card tree | 5 | 3 | 5 | 5 | 4 | Reads like a status report. Folding finished subtrees keeps 30 agents to about 8 cards. Dependency arcs in the gutter get busy. |
| 10 | Message matrix | 3 | 2 | 3 | 4 | 5 | Best for "who talks to whom" and exact for dependencies. Needs a legend to read; O(n²) cells; not a general status view. |

## Recommendation

**1. Card tree (09): the everyday default.**
- Why: the answer to "who is doing what, and what is stuck" is text on a card, so it is readable in seconds, fits a narrow side panel, and scales by folding finished subtrees.
- Tradeoffs: not beautiful, dependencies are the weakest layer, and nothing shows time.

**2. Swimlanes (07): the drill-down.**
- Why: the only concept that shows when things happened, so you can see where a blocker cost time, who waited on whom, and what overlapped.
- Tradeoffs: dense at high parallelism, needs an axis you must learn, and the least inviting at a glance. Check its reduced-motion behaviour in a real browser before relying on it.

**3. Contribution river (05): the end-of-task receipt.**
- Why: shows how every agent's effort and outputs fed the final result. No surveyed GitHub tool does this, so it is the differentiator.
- Tradeoffs: only meaningful when there is a result, ribbons cross, and effort is working time, not quality.

**Honourable mentions.** Orb web (01) as a marketing or "ambient" view (it is the literal spiderweb you first asked for), and lattice (04) if dependency debugging matters most.

## How the winner becomes the everyday interface

Proposal: **Card tree as the shell, swimlanes one click away, river shown when the task finishes.**

1. **Run it for real first.** Wire `POST /claude-hook` to a real Claude Code session (the hook mapper is only tested on synthetic payloads) and check what a real long run produces: how subagents, tool calls and approval waits actually show up. Everything else depends on this.
2. **Fix the event model gaps the ten sessions found** in `shared/`: message ids, explicit `failedAt`/`retryAt`, a "delegating" state for parents, a short tool history per agent, the `role="img"` on the stage that hides focusable children, and `AgentCore.util.topLevel` hard-coding `orch`.
3. **Make it a place, not a demo.** A small always-on local window or browser tab that starts with the adapter and follows the active session, with the source badge kept. Add a folded "needs you" strip for blocked agents, since blockers are what people act on.
4. **Add actions last.** Approve a blocked agent, retry a failed one, from the card. Only after read-only use proves trustworthy.
5. **Keep the honesty rule.** The badge stays, every simulated or self-reported view says so, and nothing is drawn that the events do not support.

## Known gaps in this report

- Videos were captured from deterministic stepping of the real page, not screen recordings of real-time playback.
- Seven of the ten sessions (02, 04 to 09) stopped at a usage limit, and most noted unchecked items (see each prototype README, "Known limits"). The uniform QA pass above covers errors, final state, reduced-motion clock and stress, but not every visual detail.
- 05's and 08's last poster were not re-inspected by their authors; all ten posters were reviewed and found no clipping, though small overlaps remain (05 message pill over the DIFF label; 06 a long delegation line crossing desks; 04 tight wire channels).
