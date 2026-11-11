# Local command center (task execution)

Type a task, press **Run**, and a real Claude Code session executes it while the dashboard shows what happens. Local, single user.

```bash
claude auth login                 # once: Claude Code must be signed in (the service uses YOUR login; it never touches credentials)
node server/lab-server.mjs        # prints http://127.0.0.1:7777/app/index.html
node tools/milestone-check.mjs    # optional: runs the first-milestone workflow for real and checks every step
```

## Architecture (and why)

| Piece | Choice | Why |
|---|---|---|
| Run Claude Code | the official CLI in headless mode: `claude -p --output-format stream-json --verbose` | official, no extra dependency, streams every message, tool call, tool result and subagent (`parent_tool_use_id`) as JSON, uses your existing login |
| Not chosen | Agent SDK (needs npm and credentials handling); hooks only (cannot start a task) | more moving parts, no gain for the MVP |
| Service | `server/lab-server.mjs` on top of the existing `shared/adapter-server.mjs`; Node only, no dependencies | reuses the SSE bus and static server |
| Events | `server/stream-mapper.mjs` maps the stream to the SAME event model every view already consumes | no visualization changes needed |
| History | `~/.agent-activity-lab/sessions/<id>/{meta.json, events.jsonl, raw.jsonl, stderr.log}` | outside the repo and the served folder |
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
| **Real subagent delegation** (`parent_tool_use_id` set on a subagent's messages, the Agent/Task tool call shape, a subagent's final report) | **NOT verified**: neither real run used a subagent (`subagent_stats.spawned` was 0). Mapped from the documented format; exercised only with the stub |
| **Follow-ups** (`--resume` with the conversation id from the stream's `session_id`; per-agent retry; approve and continue) | **NOT verified against the real CLI**: the id is captured from real runs, but no real follow-up has been run yet |
| Stop, Retry with the real CLI | not yet exercised against a real run |

Observed in real runs: Claude Code is denied shell redirection (`> file`) and `rm` under the Workspace policy and works around it with the Write tool; the dashboard shows that as blocked then unblocked ("agent continued without the denied action"), and lists the denied actions in Output. A real task costs roughly $0.10 to $0.25 (budget cap $2).

## Files

`lab-server.mjs` HTTP + security, `sessions.mjs` process and history, `stream-mapper.mjs` events, `test-*.mjs` tests, `test/fake-claude.mjs` the stub.
