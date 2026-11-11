# 07 Swimlanes

A live timeline with one lane per agent. Reference: `paper/boards/b07.svg`. Port 7807. The data is SIMULATED (shared chrome shows the badge).

Run: `node shared/adapter-server.mjs --port 7807`, then open `http://127.0.0.1:7807/prototypes/07-swimlanes/index.html` (also opens from disk). `?scenario=stress` gives 30 agents.

## Encoding
- Lanes are built from state: depth-first, subagents directly under their parent, a lane is added at `agent_spawned`.
- Bars grow with the NOW line. Teal is working; ink is done (a finished agent's bars turn ink); amber hatched is blocked; rust is a failed attempt and ends in an x marker. A retry starts a new bar labelled `#2`.
- Dotted slate line with "waits for X" is a spawned agent waiting on dependencies. Dotted light line is ready but not started. Nothing is drawn for the future (no ghost bars).
- Tool calls: tick, tool name in the bar, a light strip under the bar for the call's duration.
- Delegation / spawn: thin slate curve between lanes with a ring at the origin and a dot at the target.
- Messages: dotted green curve with an arrowhead. The text shows on hover, and for 1.6 s after the message.
- Blocked: callout pill with the reason at the NOW end. Failed: pill with the error. Both disappear when the state ends; the bar and marker stay and have tooltips.
- Outputs: page glyph on the producer's lane at the moment it appears (tooltip has name and kind).
- Task progress: "TASK · 33%" and an overall bar at the top left.
- Result: at `task_finished`, NOW is replaced by a RESULT pill and a solid line. Dotted threads run from each contributing output to that line.
- Selection (click a lane, bar or label; Enter or Space on a label): row tint, unrelated handoffs and messages dim, and dependency threads are drawn in both directions.

## Time axis and scale
- Follow mode: the axis fits the run (minimum 20 s), then scrolls as a 120 s window with NOW kept in view. Manual mode: drag the lanes to pan, Ctrl/Cmd+wheel or +/- to zoom, FOLLOW NOW (or F) to resume. Click or drag the time axis to scrub the replay (not on a live stream).
- Lane height is 30–46 px and the body scrolls vertically. If lanes would not fit, subagents of finished agents collapse automatically (oldest first); the arrow toggle overrides this. A collapsed parent shows a thin span stripe.
- The timeline model comes from played events only. After a seek or replay it is rebuilt from the player's events with `t <= state.t`. It never reads scenario.js.
- Reduced motion: no easing; NOW advances in 1 s steps.

## Checked
- Base scenario at 12 s and at the end, compared with the board: matches. `tools/capture.mjs` ran with `--select code@10500,test@12500,write@16500` and exited 0 (no page errors). Previews are in `previews/07-swimlanes.*`.
- Stress (30 agents), viewed at 12 s and at the end: it scrolls vertically at 30 px lanes. At the end 4 parents collapse to 16 lanes. Readable.
- Hover tooltips, click and keyboard select, axis scrub, zoom/pan, synthetic 330 s run (window scrolls), live adapter at 4x: seen working in the browser pane.

## Not verified / known limits
- Reduced-motion run: in the browser pane with `?reduced=1&speed=4` the clock stayed at 0 for the test I ran. I did not find out whether this is a pane artifact (the same page advanced without that flag) or a bug. Check it first.
- The stress poster was not re-captured and not inspected at 1280x800 in a recording. No stress mp4.
- Live mode at speed other than 1x: events run ahead of the local clock, so NOW is `max(clock, last event)`.
- The shared console log in the pane kept stale errors from before my fixes; the capture run is the clean evidence.
- Handoff curves from one parent to many children at the same instant form a dense vertical bundle.
- The amber pill uses ink text for contrast; white on teal bars is about 4.4:1 at 10.5 px (below AA).

## Shared issues
None changed. The `?live` clock mismatch at speeds other than 1x comes from the adapter (event `t` is scenario time, the live clock is wall time).

## Next
Fix or confirm the reduced-motion stall; a stress capture; an optional minimap for runs longer than 120 s; approve/retry actions on the blocked and failed callouts.
