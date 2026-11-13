# Agent Activity Lab pane

A mod for Claude Code. It keeps a pane beside the chat that shows the current task of this Claude Code session as a living web: Claude Code in the centre, each real subagent around it, strands showing who created whom, with what each one is doing right now.

It draws nothing of its own. The local Agent Activity Lab service on this Mac (`127.0.0.1:47821`, started by the hooks in `~/agent-activity-lab`) records the real hook events; the pane asks it for the picture (`GET /api/web`) and shows it. Nothing leaves the machine, no tool call or prompt is changed, nothing is stored.

- Desktop app: an animated drawing plus a short list of who is doing what.
- Terminal: Claude Code's terminal cannot show graphics, so the pane is the same list as text.
- Close the pane to hide it for the session. `/living-web` opens it again.
- Remove it by uninstalling the plugin; the dashboard page (`node ~/agent-activity-lab/tools/lab.mjs open`) keeps working without it.
