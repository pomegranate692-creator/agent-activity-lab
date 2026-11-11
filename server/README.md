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
| New task / Run, live view, Output (answer, files, denials, stats), History, Retry | works (against the stub; real-Claude run pending sign-in, see below) |
| Stop | works (SIGTERM, then SIGKILL) |
| Approve a denied action | **re-run only**: pick denied actions in Output and re-run with them allowed (new session). Approval *during* a run is not supported (headless mode cannot ask) |
| Pause | **not supported** (headless Claude Code cannot be paused; the button is shown disabled) |
| Concurrent tasks | one at a time |

## Verification status (what is proven, precisely)

| Claim | Evidence |
|---|---|
| Message mapping (tool_use, tool_result, errors, ids) on real Claude Code message shapes | `node server/test-stream-mapper.mjs`: 1,552 real transcript lines, 540 tool calls, every call and result accounted for |
| Service plumbing: spawn, stream, persist, files, stop, retry/approve, auth failure, security rules | `node server/test-e2e.mjs`: 57 checks using a **test stub** (`server/test/fake-claude.mjs`, labelled TEST STUB everywhere; it is not Claude) |
| Dashboard flow in a browser (dialog, run, live views, Output, History) | driven in headless Chrome against the stub, zero page errors |
| Real not-signed-in path | run against the real CLI: bootstrap reports `loggedIn:false`, the API refuses with `claude auth login` instructions |
| **A real Claude Code run, end to end** | **NOT YET DONE: the CLI on this machine is not signed in.** Run `claude auth login`, then `node tools/milestone-check.mjs` |
| `system/init` and `result` objects, `parent_tool_use_id` on subagent messages, the wording of permission-denied tool results | mapped from the documented format; **unverified until a real run** (a denial is also read from the structured `result.permission_denials`) |
| Real multiagent delegation | mapped (Agent/Task tool call = subagent), **unverified against a real run** |

## Files

`lab-server.mjs` HTTP + security, `sessions.mjs` process and history, `stream-mapper.mjs` events, `test-*.mjs` tests, `test/fake-claude.mjs` the stub.
