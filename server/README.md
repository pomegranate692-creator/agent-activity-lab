# Local command center

Two ways to use it. **Automatic mode is the primary one**: you use Claude Code normally and this dashboard follows along by itself. The second, optional way is to type a task into the dashboard and have it run Claude Code for you.

## Automatic mode: watch your own Claude Code sessions

```
You type a task in Claude Code ──hooks──▶ tools/hook-forward.mjs ──▶ local service (127.0.0.1:47821) ──▶ dashboard window
   (nothing else to do)        (official)   starts the service if needed     saves every task to History       opens by itself
```

**Install (once, needs your OK).** The hooks live in a Claude Code settings file. Nothing in this project edits your settings unless you run the installer with `--apply`:

```bash
node tools/hooks-install.mjs --scope user            # DRY RUN: prints exactly what would be added to ~/.claude/settings.json. Writes nothing.
node tools/hooks-install.mjs --scope user --apply    # writes it (a timestamped .bak copy is made first)
```

Then start a **new** Claude Code session (hooks load at session start). That is all. The first hook starts the service in the background and opens the dashboard in its own window (a Chrome `--app` window: no tabs, no address bar). Every prompt you give Claude Code becomes a task that appears there: the main agent, subagents branching from it, tool calls, errors, permission waits, outputs, and the final answer. Finished tasks stay in History.

**Turn it off, any time:**

| To | Do |
|---|---|
| pause everything (no forwarding, no autostart, no window) | `node tools/lab.mjs disable` (creates `~/.agent-activity-lab/disabled`); `node tools/lab.mjs enable` to resume |
| stop the background service | `node tools/lab.mjs stop` (a later hook starts it again unless disabled) |
| never autostart / never open a window | `~/.agent-activity-lab/config.json`: `{"autostart": false, "openWindow": false}` |
| remove the hooks | `node tools/hooks-install.mjs --scope user --remove --apply` |
| see what is going on | `node tools/lab.mjs status`, log at `~/.agent-activity-lab/server.log` |
| find out why nothing showed up | `node tools/lab.mjs doctor` checks every step: hooks in `settings.json`, absolute forwarder path, `node`, off switches, the service, hook events received, dashboard pages connected (visible / hidden), windows opened. Delivery problems are written to `~/.agent-activity-lab/forwarder.log` (no payload contents) |

What runs in the background: one Node process (`server/lab-server.mjs`), started by a hook, listening only on 127.0.0.1:47821 (change `port` in `config.json`). No LaunchAgent, no login item, nothing outside this folder and `~/.agent-activity-lab`.

**What it records and what it never sends anywhere.** Everything stays on this Mac. The forwarder shrinks each hook payload before sending: file contents and tool outputs are dropped, long strings cut. Raw payloads are never saved (only the drawn events and a short summary of each task). Files in Output are only those Claude wrote with Write/Edit in that task, served by recorded name.

**Security of the intake.** `POST /api/hook` needs the secret token (`~/.agent-activity-lab/token`, owner-only) and `application/json`. The forwarder first asks the listener to prove it knows the token (`GET /api/hello`, an HMAC) and only then sends the token, so another program on the port gets neither the token nor your prompts. The dashboard never approves or denies anything: hooks forward nothing that can answer a permission prompt, the forwarder prints nothing and always exits 0, and observed tasks have no Stop/Retry/Approve buttons. Permission prompts stay in your Claude Code terminal.

**Limits of what hooks can show (be precise):**
- Hooks carry tool calls, subagent start/stop, permission requests, notifications and the end of a turn. They do **not** carry Claude's streaming text or reasoning, so cards show tools, statuses and the final message, not thinking.
- A subagent's tool calls are attributed to it (`agent_id`), and its final report is shown when it stops. Agents that Claude Code does not report through hooks cannot be shown.
- Each prompt you type is one task. Claude Code's own synthetic prompts for a background agent reporting back (`<task-notification>` in headless runs, `<agent-message from="…"> [Subagent hand-back]` in interactive sessions) are the same task continuing, not a new one. The task finishes at the Stop whose `background_tasks` is empty.
- Interactive Claude Code also fires `SubagentStop` for an internal helper that never had a `SubagentStart` (empty `agent_type`, no saved transcript; its text is a short progress line). It is not drawn: it is not an agent your task created.
- **Where it appears.** Inside the Claude desktop app, not in a separate window. The folder `mod/agent-activity-lab` is a Claude Code mod (installed as the plugin `agent-activity-lab@agent-activity-lab-local`). Each time you submit a task it opens the full dashboard (`http://127.0.0.1:47821/app/index.html`) in the app's own browser pane, beside the chat, unless it is already open there; it writes one line per attempt to `~/.agent-activity-lab/mod.log`. Where there is no browser pane (a terminal session) it shows a small pane of its own instead: the Living Web as an image where the surface can draw one (`GET /api/web`, drawn by this service from the same real events) and a list of who is doing what as text. `/living-web` opens that small pane by hand. Remove it all with `claude plugin uninstall agent-activity-lab@agent-activity-lab-local`.
- **The separate window is now opt-in.** `~/.agent-activity-lab/config.json` contains `{"openWindow": false}`. Set it to `true` to get the old behaviour back (described next).
- **The window.** The first task you submit in each Claude Code session brings the dashboard to the front in its own window; older dashboard pages close themselves. Exception: if a dashboard page has keyboard focus at that moment, nothing opens. Later tasks in the same session open a window only if no dashboard page is connected (you closed it). Nothing opens when Claude Code merely starts, so a window never appears while you are typing. At most one window per 30 s.
- **The connection.** Every open dashboard page holds one live connection to the service and shows its state in the top bar ("Connected · local service" or "NOT connected … Reconnecting"). It reconnects by itself, reloads itself when the service runs newer code, and never falls back to the scripted demo while served by the service. `node tools/lab.mjs doctor` lists each connected page (visible / focused / hidden); `server.log` has a timestamped line for every page connect, disconnect and window opened.
- Pressing Esc to interrupt fires no hook we know of, so such a task is closed as **ended** (never "succeeded") when you submit the next prompt or after 30 silent minutes (`staleMinutes`).
- A prompt typed while Claude is still working starts a new task; the earlier one is closed as ended with that reason.
- `PermissionRequest` and `Notification` hooks (what makes an agent show as waiting for you) were seen working in one real interactive session (an `AskUserQuestion`: blocked, then unblocked when answered). A real tool-permission prompt has not been captured yet.
- Sessions started with `claude -p` by other tools also fire user-level hooks and will show up as tasks.

### Run the service by hand (optional)

```bash
node tools/lab.mjs start            # or: node server/lab-server.mjs
node tools/lab.mjs open             # opens the dashboard window
```

### Optional second mode: run a task from the dashboard

Type a task, press **Run**, and a real Claude Code session executes it (details below). One task at a time.

```bash
claude auth login                 # once: Claude Code must be signed in (the service uses YOUR login; it never touches credentials)
node tools/milestone-check.mjs    # optional: runs the first-milestone workflow for real and checks every step
```

## Architecture (and why)

| Piece | Choice | Why |
|---|---|---|
| Run Claude Code | the official CLI in headless mode: `claude -p --output-format stream-json --verbose` | official, no extra dependency, streams every message, tool call, tool result and subagent (`parent_tool_use_id`) as JSON, uses your existing login |
| Not chosen | Agent SDK (needs npm and credentials handling); hooks only (cannot start a task) | more moving parts, no gain for the MVP |
| Service | `server/lab-server.mjs` on top of the existing `shared/adapter-server.mjs`; Node only, no dependencies | reuses the SSE bus and static server |
| Events | `server/stream-mapper.mjs` maps the stream to the SAME event model every view already consumes | no visualization changes needed |
| History | `~/.agent-activity-lab/sessions/<id>/{meta.json, events.jsonl, stderr.log}`, plus `raw.jsonl` (full Claude output) only when recording is turned on with `node tools/lab.mjs record-output on` (off by default) | outside the repo and the served folder |
| Workspaces | a fresh folder per task under `~/.agent-activity-lab/workspaces/` | isolation, easy "what did it create" |

## Security (it is a code-execution surface)

- Listens on 127.0.0.1 only; refuses requests whose Host is not 127.0.0.1:PORT or localhost:PORT (DNS rebinding); sends no CORS headers; cross-site POSTs are refused.
- Every `/api` call needs a secret token (`X-Lab-Token`, stored 0600 in `~/.agent-activity-lab/token`). The dashboard fetches it from `/api/bootstrap`, which only answers a same-origin browser request.
- Prompts go to Claude Code on stdin; the process starts from an argument list, never through a shell. Prompt max 8000 chars.
- Policies: **Read only**, or **Workspace** (read, write, edit, Python and a few read-only commands, subagents). Everything else is denied by Claude Code and shown as blocked; `rm`, `sudo`, `curl`, `wget`, `git push`, `ssh` are also explicitly denied. User-level Claude settings and MCP servers are not loaded (`--setting-sources project,local --strict-mcp-config`), so your own allow-rules cannot widen what a task may do. Budget cap $2 and 15 minutes per task.
- **Python can run arbitrary code with your user permissions.** The Workspace policy is therefore a trust decision about the task you type; the dialog says so. Use Read only for untrusted input. There is no OS sandbox.
- Generated files are served as `text/plain` (sandboxed CSP) or as downloads, never as HTML. Dotfiles are never served. File paths are resolved and must stay inside the session workspace.
- GitHub Pages cannot reach this service and is not meant to: it stays the public SIMULATED demo.

## Controls and what is NOT supported

| Control | State |
|---|---|
| New task / Run, live view, Output (answer, files, denials, stats), History | **works with real Claude Code** (verified, see below) |
| Retry | works with the stub; not yet exercised with a real run |
| Stop | works (SIGTERM, then SIGKILL) |
| Approve a denied action | **approve and continue**: from the inspector (agent blocked on a denial) or the Output tab, after the run ends. Continues the SAME Claude Code conversation in the SAME workspace (`--resume`) with exactly the approved rule added, as a new linked session. Only rules that were really denied can be approved; a confirmation names the rule. If the session has no conversation id, it offers a full re-run instead. Approval *during* a run is not supported (headless mode cannot ask) |
| Retry one agent | from the inspector of a **failed** agent, after the run ends: continues the same conversation and asks Claude Code to redo only that part (the instruction is built by the server from the recorded failure, not from client text). Linked, confirmed, same policy and budget cap |
| Pause | **not supported** (headless Claude Code cannot be paused; the button is shown disabled) |
| Concurrent tasks | one at a time |

## Verification status (what is proven, precisely)

Verified on 2026-11-10 with Claude Code 2.1.263 (model claude-sonnet-5), signed in with a claude.ai account.

| Claim | Evidence |
|---|---|
| **A real Claude Code run end to end** | `node tools/milestone-check.mjs` passed (real session, 3 tool calls, the generated script ran on a sample CSV, session saved). The same CSV task was then run **through the app** twice (Run button, Card tree, Tool stream, Output, History): both sessions succeeded, produced a working script and `sample.csv`, and were saved |
| Real `system/init` (session_id, model, permissionMode), `result` (subtype, is_error, num_turns, total_cost_usd, duration_ms, permission_denials) and the `parent_tool_use_id` key on messages | read from the recorded raw streams; two redacted real runs are regression fixtures (`server/fixtures/real-claude-run*.jsonl`, `node server/test-real-stream.mjs`) |
| Real-only stream objects (`thinking_tokens`, `rate_limit_event`, `task_summary`, `post_turn_summary`) | present in real runs and safely ignored |
| Real permission-denial wording | seen twice: "Permission to use Bash with command ... has been denied." and "Output redirection to ... was blocked. For security, Claude Code may only write to files in the allowed working directories". Both show as **blocked**, not failed, and match the structured `result.permission_denials` |
| Bugs found only by real runs, now fixed and tested | tool paths arrive as `./file` (files were announced twice); the blocked-redirect wording was shown as a failure; the app played the scripted demo behind a live service |
| Message mapping on real message shapes | `node server/test-stream-mapper.mjs`: 1,552 real transcript lines |
| Service plumbing, security rules, follow-ups, dashboard flow | `node server/test-e2e.mjs` (74 checks) and `node tools/app-test.mjs` (39 checks) using a **test stub** (labelled TEST STUB; not Claude) |
| **Automatic mode** (hooks → service → dashboard), real Claude Code 2.1.263 | five real sessions through the real pipeline (service auto-started by the SessionStart hook; dashboard window opened by the service). Real payloads captured and committed as redacted fixtures: `shared/fixtures/real-hook-session-subagent.jsonl` (foreground subagent) and `real-hook-session-background-subagent.jsonl` (background subagent: Stop arrives while it still runs, `background_tasks` is non-empty, a synthetic `<task-notification>` prompt follows). For the last session the dashboard recorded exactly what Claude's own stream-json shows: 5 main + 2 subagent tool calls, 1 subagent, 3 files, one task, final answer. Tests: `node shared/test-real-hook-session.mjs`, `node server/test-observer.mjs` (116 checks), `node tools/observe-test.mjs` (36 checks in headless Chrome) |
| Bugs found only by real automatic-mode runs, now fixed and tested | the `Agent` tool call and `SubagentStart` each created a subagent (duplicate); a background subagent's reporting-back prompt (`<task-notification>`) started a second task; tool events after the first Stop were dropped |
| **Subagent delegation as seen through hooks** | **verified** (agent_id/agent_type on every subagent hook, SubagentStart/SubagentStop, last_assistant_message). Delegation from a dashboard-run task (`parent_tool_use_id` in the stream-json path) is still only exercised with the stub |
| **Genuine interactive sessions** (the `claude` TUI, user-level hooks, started from the home directory) | three real sessions with two background subagents each, driven through a pty. Redacted capture: `shared/fixtures/real-interactive-background-agents.jsonl` (59 payloads). Found and fixed: `<agent-message>` hand-back prompts split one task into three and marked it *ended*; internal helper `SubagentStop`s were drawn as phantom "Subagent (start not observed)" cards; a hidden dashboard window blocked the automatic window; titles of prompts pasted from a terminal were a line of dashes |
| `PermissionRequest` / `Notification` hooks (agent waiting for you) | **partly verified**: one real interactive `AskUserQuestion` showed blocked then unblocked. A real tool-permission prompt is **not** captured yet |
| **Follow-ups** (`--resume` with the conversation id from the stream's `session_id`; per-agent retry; approve and continue) | **NOT verified against the real CLI**: the id is captured from real runs, but no real follow-up has been run yet |
| Stop, Retry with the real CLI | not yet exercised against a real run |

Observed in real runs: Claude Code is denied shell redirection (`> file`) and `rm` under the Workspace policy and works around it with the Write tool; the dashboard shows that as blocked then unblocked ("agent continued without the denied action"), and lists the denied actions in Output. A real task costs roughly $0.10 to $0.25 (budget cap $2).

## Files

`lab-server.mjs` HTTP + security, `sessions.mjs` process and history, `stream-mapper.mjs` events, `test-*.mjs` tests, `test/fake-claude.mjs` the stub.
