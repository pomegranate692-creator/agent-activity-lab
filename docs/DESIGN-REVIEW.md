# Design review: choosing ONE primary visualization

**DECISION (owner): Card tree is the primary visualization.** Implemented in `app/cards/`; the other designs and the layer experiments are in `archive/`.

Goal: an interactive AI agent command center on real activity, one exceptionally polished primary view.

**How the scores were made.** Judgment of the author (an AI), from: the t = 12 s poster of every design, the final-state and 30-agent stress frames, each prototype's README (known limits), the objective QA pass (`node tools/qa.mjs`), and real replays of a recorded Claude Code session through three of the designs. No user has used any of them on real work. 5 is best.

| # | Design | Clarity | Usability | Real-time monitoring | Scale (30 agents) | Aesthetics | Total |
|---|---|---|---|---|---|---|---|
| 09 | Card tree | 5 | 5 | 4 | 5 | 3 | **22** |
| 07 | Swimlanes | 5 | 4 | 5 | 4 | 3 | **21** |
| 05 | Contribution river | 4 | 3 | 2 | 3 | 5 | 17 |
| 03 | Radar | 4 | 3 | 3 | 3 | 4 | 17 |
| 06 | Floorplan | 4 | 3 | 3 | 3 | 4 | 17 |
| 01 | Orb web | 3 | 3 | 3 | 2 | 5 | 16 |
| 02 | Hive cells | 3 | 3 | 3 | 3 | 4 | 16 |
| 08 | Territories | 3 | 3 | 3 | 3 | 4 | 16 |
| 04 | Routed lattice | 3 | 3 | 3 | 3 | 3 | 15 |
| 10 | Message matrix | 3 | 3 | 3 | 4 | 2 | 15 |

Criteria: **clarity** = can you read who is doing what, what is stuck and why, at a glance; **usability** = selecting, inspecting, keyboard, room for actions; **real-time** = does it read well while events stream in and what is happening now; **scale** = 30 agents; **aesthetics** = visual polish and distinctiveness. Three designs tie at 17 for third place; River is chosen because it has the highest aesthetics score and answers a question no surveyed tool answers (how did everything feed the result), but its real-time score is the weakest of the three.

## The three finalists

Screenshots: `docs/review/finalist-09-card-tree.png`, `finalist-07-swimlanes.png`, `finalist-05-contribution-river.png` (left: the all-states moment; right: 30 agents mid-run).

### 09 Card tree
- **For:** reads like a status report (state text on every card), works from 1 to 30 agents because finished subtrees fold, narrow enough for a side panel, and has obvious room for per-card actions (approve, retry). Tested live on a real replay.
- **Against:** the least beautiful of the three, shows no time, dependency arcs in the gutter get busy at scale, long runs need scrolling.

### 07 Swimlanes
- **For:** the best real-time view: bars grow as work happens, a NOW needle, blocked and failed pills with reasons, waiting shown as dotted spans, handoffs as curves. The only design that shows when things happened. Auto-collapses finished subagents at scale.
- **Against:** denser to learn, handoff bundles get busy with many parallel children, a lane per agent grows tall, weakest at a glance for "what needs me" (the Needs-you strip covers that), plain look.

### 05 Contribution river
- **For:** the most distinctive and attractive; shows how effort and outputs flowed into the result. Blocked as an amber dam, failed as a rust eddy.
- **Against:** only meaningful once there is a result, layout shifts when late agents spawn, long ribbons cross the middle, labels become ids at scale, weakest for live monitoring.

Runners-up: Radar (03) and Floorplan (06) are attractive and clear at 12 agents but lose clarity at scale; Orb web (01) is the most striking but worst at scale.

## Recommendation

**Card tree (09) as the primary view**, refined to become the command center:
- add a thin per-card timeline strip borrowed from Swimlanes, so each card also shows when its agent was active;
- make cards the home of actions (approve a blocked agent, retry a failed one, stop a run) once the task execution system exists;
- keep the Needs-you strip, the inspector, playback and the Tool stream (default when a run has 1 to 2 agents, which is the common real case).

Swimlanes remains the strongest alternative if "what is happening over time" matters more to you than "what needs me and what is each agent doing".

## If you choose

The consolidation plan: make the chosen design the primary view across `app/`; remove the 10-layer toggle interface from the main app; keep Tool stream, inspector, controls and Needs-you; move the other designs, `app/all.html` and `app/one.html` into an archive/development gallery with a clear label; then refine the chosen design for live execution.
