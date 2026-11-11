#!/usr/bin/env python3
"""Single source of truth for the shared demo scenario.

Writes scenario.json (data) and scenario.js (same data as window.AGENT_SCENARIO so
prototypes also work when opened straight from file://).

Every event here is SIMULATED. Nothing in this file represents real agent work.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))

TASK = {
    "id": "task-1",
    "title": "Ship the v2.3 release notes",
    "goal": "Research what changed, patch the changelog, test it, write the notes, review, publish a draft release.",
}

# id, display name, short label, role, parent
AGENTS = [
    ("orch",  "Orchestrator", "ORCH",   "Coordinates the task and delegates work",        None),
    ("plan",  "Planner",      "PLAN",   "Breaks the release into work items",             "orch"),
    ("res",   "Researcher",   "RESEARCH", "Finds what changed since v2.2",                "orch"),
    ("web",   "Web search",   "WEB",    "Searches public changelogs and issues",          "res"),
    ("docs",  "Docs reader",  "DOCS",   "Reads the API docs for renamed endpoints",       "res"),
    ("diff",  "Diff reader",  "DIFF",   "Reads git history between v2.2 and v2.3",        "res"),
    ("code",  "Coder",        "CODE",   "Patches CHANGELOG.md and snapshots",             "orch"),
    ("lint",  "Linter",       "LINT",   "Runs eslint over the patch",                     "code"),
    ("test",  "Tester",       "TEST",   "Runs the test suite",                            "orch"),
    ("write", "Writer",       "WRITE",  "Drafts the release notes",                       "orch"),
    ("rev",   "Reviewer",     "REVIEW", "Reviews the draft against the diff",             "orch"),
    ("ship",  "Publisher",    "SHIP",   "Creates the draft GitHub release",               "orch"),
]
DEPENDS = {
    "res": ["plan"], "code": ["plan"],
    "test": ["lint"],
    "write": ["res", "test"],
    "rev": ["write"],
    "ship": ["rev"],
}
ROLE = {a[0]: a[3] for a in AGENTS}
NAME = {a[0]: a[1] for a in AGENTS}
LABEL = {a[0]: a[2] for a in AGENTS}
PARENT = {a[0]: a[4] for a in AGENTS}

ev = []
def e(t, type_, **kw):
    ev.append({"t": t, "type": type_, **kw})

e(0,     "task_started", task=TASK)
e(300,   "agent_spawned", agentId="orch", name=NAME["orch"], label=LABEL["orch"], role=ROLE["orch"], parentId=None, dependsOn=[])
e(800,   "tool_called", agentId="orch", tool="read_task", input="release v2.3 request", durationMs=500)
e(1400,  "agent_spawned", agentId="plan", name=NAME["plan"], label=LABEL["plan"], role=ROLE["plan"], parentId="orch", dependsOn=[])
e(1400,  "work_delegated", fromId="orch", toId="plan", workId="w-plan", description="Break the release into work items")
e(2200,  "tool_called", agentId="plan", tool="list_commits", input="v2.2..v2.3", durationMs=900)
e(3300,  "output_produced", agentId="plan", outputId="o-plan", name="plan.md", kind="doc")
e(3700,  "agent_completed", agentId="plan")

# Handoff to two parallel branches. Every remaining agent is spawned now so the whole
# plan is visible: some start working, some wait on dependencies.
e(4000,  "agent_spawned", agentId="res", name=NAME["res"], label=LABEL["res"], role=ROLE["res"], parentId="orch", dependsOn=DEPENDS["res"])
e(4000,  "work_delegated", fromId="orch", toId="res", workId="w-res", description="Find what changed since v2.2")
e(4000,  "agent_spawned", agentId="code", name=NAME["code"], label=LABEL["code"], role=ROLE["code"], parentId="orch", dependsOn=DEPENDS["code"])
e(4000,  "work_delegated", fromId="orch", toId="code", workId="w-code", description="Patch CHANGELOG.md")
for aid in ("test", "write", "rev", "ship"):
    e(4200, "agent_spawned", agentId=aid, name=NAME[aid], label=LABEL[aid], role=ROLE[aid], parentId="orch", dependsOn=DEPENDS[aid])
e(4400,  "agent_spawned", agentId="web",  name=NAME["web"],  label=LABEL["web"],  role=ROLE["web"],  parentId="res", dependsOn=[])
e(4400,  "agent_spawned", agentId="docs", name=NAME["docs"], label=LABEL["docs"], role=ROLE["docs"], parentId="res", dependsOn=[])
e(4400,  "agent_spawned", agentId="diff", name=NAME["diff"], label=LABEL["diff"], role=ROLE["diff"], parentId="res", dependsOn=[])
e(4400,  "work_delegated", fromId="res", toId="web",  workId="w-web",  description="Search public changelogs")
e(4400,  "work_delegated", fromId="res", toId="docs", workId="w-docs", description="Read API docs")
e(4400,  "work_delegated", fromId="res", toId="diff", workId="w-diff", description="Read git history")
e(4800,  "tool_called", agentId="web",  tool="web_search", input="acme v2.3 changelog", durationMs=1800)
e(4800,  "tool_called", agentId="docs", tool="read_docs",  input="api/v2/sync", durationMs=1600)
e(4900,  "tool_called", agentId="diff", tool="git_log",    input="v2.2..v2.3 --stat", durationMs=7000)
e(5200,  "tool_called", agentId="code", tool="edit_file",  input="CHANGELOG.md", durationMs=2600)
e(5900,  "message_sent", fromId="web", toId="res", text="Found 3 changelog sources")
e(6600,  "message_sent", fromId="res", toId="code", text="Endpoint renamed to /v2/sync")
e(7400,  "output_produced", agentId="web", outputId="o-web", name="web-notes.md", kind="doc")
e(7400,  "agent_completed", agentId="web")
e(7600,  "agent_completed", agentId="docs")

e(8600,  "agent_spawned", agentId="lint", name=NAME["lint"], label=LABEL["lint"], role=ROLE["lint"], parentId="code", dependsOn=[])
e(8600,  "work_delegated", fromId="code", toId="lint", workId="w-lint", description="Lint the patch")
e(8700,  "tool_called", agentId="lint", tool="eslint", input="CHANGELOG.md", durationMs=900)
e(9400,  "agent_blocked", agentId="code", reason="Needs approval to run git push --dry-run", needs="human approval")
e(9600,  "agent_completed", agentId="lint")

# Failure while the coder is still blocked
e(9800,  "tool_called", agentId="test", tool="pytest", input="tests/ -q", durationMs=1400)
e(11200, "agent_failed", agentId="test", error="2 snapshot tests failing")
e(11400, "message_sent", fromId="test", toId="code", text="changelog.snap does not match")

# Recovery
e(12200, "agent_unblocked", agentId="code", by="human approval")
e(12500, "tool_called", agentId="code", tool="edit_file", input="changelog.snap", durationMs=700)
e(12900, "output_produced", agentId="diff", outputId="o-diff", name="diff-summary.md", kind="doc")
e(12900, "agent_completed", agentId="diff")
e(13000, "output_produced", agentId="res", outputId="o-res", name="sources.md", kind="doc")
e(13000, "agent_completed", agentId="res")
e(13300, "output_produced", agentId="code", outputId="o-code", name="changelog.patch", kind="patch")
e(13500, "agent_completed", agentId="code")
e(13800, "agent_retry", agentId="test", attempt=2)
e(13900, "tool_called", agentId="test", tool="pytest", input="tests/ -q", durationMs=1200)
e(15200, "output_produced", agentId="test", outputId="o-test", name="test-report.html", kind="report")
e(15200, "agent_completed", agentId="test")

e(15500, "work_delegated", fromId="orch", toId="write", workId="w-write", description="Draft the release notes")
e(15600, "tool_called", agentId="write", tool="draft_notes", input="plan.md + sources.md", durationMs=1800)
e(15900, "message_sent", fromId="res", toId="write", text="Use sources.md for links")
e(17400, "output_produced", agentId="write", outputId="o-write", name="release-notes.md", kind="doc")
e(17600, "agent_completed", agentId="write")
e(17700, "work_delegated", fromId="orch", toId="rev", workId="w-rev", description="Review the draft")
e(17800, "tool_called", agentId="rev", tool="review_diff", input="release-notes.md", durationMs=1300)
e(18600, "message_sent", fromId="rev", toId="write", text="One nit in the header, otherwise good")
e(19200, "output_produced", agentId="rev", outputId="o-rev", name="review.md", kind="doc")
e(19400, "agent_completed", agentId="rev")
e(19500, "work_delegated", fromId="orch", toId="ship", workId="w-ship", description="Publish a draft release")
e(19600, "tool_called", agentId="ship", tool="gh release create", input="v2.3 --draft", durationMs=1300)
e(21000, "output_produced", agentId="ship", outputId="o-ship", name="release v2.3 (draft)", kind="release")
e(21200, "agent_completed", agentId="ship")
e(21400, "agent_completed", agentId="orch")
e(21600, "task_finished", status="succeeded", outputIds=["o-plan","o-web","o-diff","o-res","o-code","o-test","o-write","o-rev","o-ship"],
  summary="Draft release v2.3 created. One test failure recovered by retry; one approval granted.")

ev.sort(key=lambda x: x["t"])
meta = {
    "title": TASK["title"],
    "source": "simulated",
    "sourceNote": "Scripted scenario. No real agents are running. Replace with a live adapter to show real work.",
    "durationMs": 21600,
    "agents": [{"id": a[0], "name": a[1], "label": a[2], "role": a[3], "parentId": a[4], "dependsOn": DEPENDS.get(a[0], [])} for a in AGENTS],
    "snapshotMs": 12000,
}
doc = {"meta": meta, "events": ev}
with open(os.path.join(HERE, "scenario.json"), "w") as f:
    json.dump(doc, f, indent=1)
with open(os.path.join(HERE, "scenario.js"), "w") as f:
    f.write("// Generated by make_scenario.py. SIMULATED events, not real agent work.\n")
    f.write("window.AGENT_SCENARIO = " + json.dumps(doc) + ";\n")
print(len(ev), "events,", len(AGENTS), "agents, duration", meta["durationMs"], "ms")
