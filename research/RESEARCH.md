# Research: how people visualize agents working

Snapshot taken 2026-11-10 from the GitHub API (`gh`). Star counts, licenses, push dates and releases below were read from the API that day, not recalled.

## Method

- 30 keyword queries on GitHub repository search (e.g. "agent dashboard", "claude code monitor", "pixel agents", "agent swarm", "agent trace", "agent topology"), 40 results each, sorted by stars.
- **1,047 unique repositories screened.** 376 passed a relevance filter (visual/monitor/trace words plus agent words, 8+ stars, not archived). Full list: [`screened-candidates.csv`](screened-candidates.csv).
- The top ~110 were read by description. **18 were examined closely**: API stats, full README, stack signals, media links, stated limits. Their stats are in [`deep.json`](deep.json); the full list of 1,047 is in [`screened_all.json`](screened_all.json).
- Web search was used to find feature requests in issue trackers, so we can separate *built* from *wished for*.
- Not done: I did not run each tool locally or download third-party screenshots (licensing). Media is linked, not copied. "Works" below means "the README documents it and the repo is active", not "I verified it by running it".

## The strongest 15, at a glance

| Repo | ★ | License | Last push | Metaphor | Data source |
|---|---|---|---|---|---|
| [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) | 10,145 | MIT | 2026-11-10 (v1.6.0) | Pixel-art office, one character per agent | Claude Code hooks or JSONL polling |
| [ringhyacinth/star-office-ui](https://github.com/ringhyacinth/star-office-ui) | 7,569 | NOASSERTION (repo description says code is MIT; art assets carry separate terms) | 2026-03-11 | Pixel office for OpenClaw | Agents push state over HTTP |
| [matt1398/claude-devtools](https://github.com/matt1398/claude-devtools) | 4,035 | MIT | 2026-09-26 (v0.5.0, May) | DevTools-style session inspector | Session log files |
| [Dimillian/CodexMonitor](https://github.com/Dimillian/CodexMonitor) | 4,366 | MIT | 2026-03-26 | Tauri desktop monitor for Codex | Codex app server |
| [graykode/abtop](https://github.com/graykode/abtop) | 3,836 | MIT | 2026-09-14 (v0.5.5) | `htop` for agents (Rust TUI) | Local process/file state, optional hook |
| [Octane0411/open-vibe-island](https://github.com/Octane0411/open-vibe-island) | 2,070 | **GPL-3.0** | 2026-11-02 (v1.3.2) | macOS "notch" control center, approve actions | Hooks across many agents |
| [patoles/agent-flow](https://github.com/patoles/agent-flow) | 1,777 | Apache-2.0 | 2026-10-29 (v0.9.4) | Live node graph of agents and tool calls | HTTP hook server, Codex rollout tailing, JSONL |
| [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 1,566 | **none declared** | 2026-02-08 | Event timeline per app/session | Hook scripts -> HTTP -> SQLite -> WebSocket -> Vue |
| [GreenSheep01201/claw-empire](https://github.com/GreenSheep01201/claw-empire) | 1,445 | Apache-2.0 | 2026-03-16 | CEO office sim + Kanban lifecycle | CLI/API agents |
| [hoangsonww/Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | 1,169 | MIT | 2026-11-08 (v2.4.5) | Dashboard + Kanban status board + D3 | Hooks into SQLite, WebSocket |
| [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) | 905 | MIT | 2026-10-09 | Cartoon 3D office | Runs Claude Code workers itself |
| [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) | 352 | MIT | 2026-11-10 (v1.1.2) | Isometric pixel office | Hooks -> WebSocket |
| [FankChen/tracecrate](https://github.com/FankChen/tracecrate) | 195 | MIT | 2026-10-22 | Local trace workbench, compare runs | Claude Code, Codex, OTLP logs |
| [aemrebarut/herdr-dagr](https://github.com/aemrebarut/herdr-dagr) | 149 | Apache-2.0 | 2026-08-23 (v0.3.1) | Live DAG like `git log --graph` | Agents report through a "producer" skill |
| [Kirito14IT/prompt-spider-ui](https://github.com/Kirito14IT/prompt-spider-ui) | 112 | MIT | 2026-11-03 | **Canvas spider web**, three branches | MCP: agent reports its own steps |

Also reviewed, not in the table: [everettjf/coding-agent-visualizer](https://github.com/everettjf/coding-agent-visualizer) (20★, MIT; execution graph, span waterfall, flame graph, file heatmap), [jihe520/agent-graph](https://github.com/jihe520/agent-graph) (96★, MIT; git-graph as the main interaction instead of chat sessions), [NateBJones-Projects/ringer](https://github.com/NateBJones-Projects/ringer) (313★, pre-1.0 HUD), plus platform-scale observability: [langwatch/langwatch](https://github.com/langwatch/langwatch) (5,023★, Apache-2.0, active), [AgentOps-AI/agentops](https://github.com/AgentOps-AI/agentops) (5,954★, MIT, last push 2026-06), and the library [vasturiano/3d-force-graph](https://github.com/vasturiano/3d-force-graph) (6,556★, MIT).

## Demos and screenshots (linked, not copied)

- agent-flow demo video: https://www.youtube.com/watch?v=Ud6eDrFN-TA
- abtop demo: https://raw.githubusercontent.com/graykode/abtop/main/assets/demo.gif
- open-vibe-island demo: https://github.com/Octane0411/open-vibe-island/blob/main/docs/images/demo.gif
- prompt-spider-ui preview: https://github.com/Kirito14IT/prompt-spider-ui/blob/main/docs/preview.gif
- disler observability walkthrough: https://youtu.be/RpUTF_U4kiw
- Claude-Office: https://github.com/W17ant/Claude-Office/blob/main/docs/images/claude-crab.gif
- claude-devtools site: https://claude-dev.tools · Agent Monitor site: https://hoangsonww.github.io/Claude-Code-Agent-Monitor/ · tracecrate: https://fankchen.github.io/tracecrate/ · coding-agent-visualizer: https://everettjf.github.io/coding-agent-visualizer/ · agent-graph: https://jihe520.github.io/agent-graph/
- star-office-ui screenshots: `docs/screenshots/` in the repo.

## What works vs what is only wished for

**Built (documented in READMEs, repos active):** live node graphs of agents and tool calls (agent-flow); pixel offices with per-agent activity, speech bubbles, hand-raise on permission prompts, a whiteboard bound to the real task list (pixel-agents, Claude-Office); parent/subagent trees and Kanban status (Agent Monitor); htop-style sessions with tokens, context %, ports (abtop); waterfall, flame graph, file heatmap (coding-agent-visualizer, claude-devtools); DAG with attempts, review gates and evidence (herdr-dagr); self-reported steps over MCP with JSON replay (prompt-spider-ui).

**Only requested so far (issues/feature requests, not shipped):** an "Agent Hierarchy Dashboard" for Claude Code ([anthropics/claude-code#24537](https://github.com/anthropics/claude-code/issues/24537)); a task-DAG web dashboard ([open-multi-agent#4](https://github.com/open-multi-agent/open-multi-agent/issues/4)); a live agent-graph view for Hive ([aden-hive/hive#4730](https://github.com/aden-hive/hive/issues/4730)); live inspection of running subagents in Codex ([openai/codex#47224](https://github.com/openai/codex/issues/47224)) and oh-my-pi ([#3815](https://github.com/can1357/oh-my-pi/issues/3815)). Treat these as evidence of demand, not of working tools.

## Patterns

1. **Three families, each with a blind spot.**
   - *Offices/characters* (pixel-agents, Claude-Office, claw-empire, agent-office, star-office-ui): delightful, great ambient awareness, easy to explain. READMEs describe idle/working/needs-you poses; none shows dependencies or "what fed the final result" as a first-class idea (my reading of the READMEs).
   - *Graphs/traces* (agent-flow, claude-devtools, coding-agent-visualizer, tracecrate): strong on causality and debugging, dense, and several read logs after the fact.
   - *TUIs/control panels* (abtop, herdr-dagr): cheap, fast, glanceable, but low in visual storytelling.
2. **Three ways to get the data**: hooks (agent-flow, disler, Claude-Office, pixel-agents), transcript/JSONL or process tailing (devtools, abtop, pixel-agents, agent-flow for Codex), and agent self-report over MCP/HTTP (prompt-spider-ui, star-office-ui, herdr-dagr). Self-report is easy to integrate but trust is a problem.
3. **Gaps nobody fills well**: *why* an agent is blocked or waiting, outputs/artifacts as visible objects, cross-agent messages with direction and content, and a clear "how did this result come together" ending.

## What to borrow, improve, avoid

**Borrow**
- Evidence tiers from herdr-dagr (verified / reported / heuristic). We will extend this to **live / transcript / self-reported / simulated** on every event. This is how we avoid ever passing a demo off as real work.
- Needs-you hand raise with an inline approve action (Claude-Office, open-vibe-island): blocked states should say *what is needed* and let you act.
- Self-report adapter with stable step IDs (prompt-spider-ui): a tiny, framework-neutral way to feed any agent into the UI.
- Hook server + JSONL log as dual ingestion (agent-flow): live when hooks exist, replay when they do not.
- Attempts and gates as first-class (herdr-dagr): failures show as retries, not overwritten state.
- Replay, pause and scrub (prompt-spider-ui, agent-flow, disler): required for a "show me what happened" interface.

**Improve**
- Make outputs visible objects that travel and accumulate toward the result.
- Show blockers with a reason and an owner, not just a red color.
- Put delegation and dependency in one picture without needing a debugger's density.

**Avoid**
- Mascot-first designs that hide structure. Charm is good as a *layer*, not the only encoding.
- Copying code or art from repos with restrictive terms: open-vibe-island is **GPL-3.0**, star-office-ui art is restricted, disler's repo declares **no license**, ringer's is NOASSERTION. We borrow ideas only.
- Depending on tools that look stale: claw-empire (last push 2026-03), star-office-ui (2026-03), disler (2026-02), CodexMonitor (2026-03).
- Claiming liveness. prompt-spider-ui is a good model: its demo exports state `modelCalls: 0` so nobody mistakes animation for real work.

## How this changed our designs

- Every board now shows the same scenario snapshot, with **blocked, failed→retry, waiting, working, done** states and **outputs**, because that is the gap in the field.
- A **source badge** (SIMULATED / LIVE) is part of every prototype, from herdr-dagr's evidence tiers.
- The orb web stays as one literal "spiderweb" direction (prompt-spider-ui proves it is distinctive), but the other nine are different metaphors on purpose.
