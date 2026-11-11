#!/usr/bin/env python3
"""Generates the ten Paper board SVGs from shared/scenario.json at the snapshot time.
Every board shows the same moment of the same simulated scenario.
"""
import json, math, os, random, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SC = json.load(open(os.path.join(HERE, "..", "shared", "scenario.json")))
META, EVENTS = SC["meta"], SC["events"]
SNAP = META["snapshotMs"]
W, H = 804, 680
CX, CY = W / 2, H / 2

BG = "#EAE8E1"; INK = "#1F2528"; MIST = "#B7BCB8"; SLATE = "#56636A"; ACC = "#1F8A7A"
AMB = "#B7790A"; RUST = "#B5472F"
STATE_COL = {"working": ACC, "done": INK, "blocked": AMB, "failed": RUST, "waiting": INK, "queued": MIST}

# ---------------- replay the scenario to the snapshot ----------------
class A: pass
agents = collections.OrderedDict()
for a in META["agents"]:
    o = A(); o.id = a["id"]; o.name = a["name"]; o.label = a["label"]; o.parent = a["parentId"]
    o.deps = a["dependsOn"]; o.state = None; o.tool = None; o.outputs = []; o.error = None; o.reason = None
    o.attempt = 1; o.children = []
    agents[a["id"]] = o
for o in agents.values():
    if o.parent: agents[o.parent].children.append(o.id)
messages = []; delegations = []
def deps_met(o): return all(agents[d].state == "done" for d in o.deps)
for ev in EVENTS:
    if ev["t"] > SNAP: break
    t = ev["type"]
    if t == "agent_spawned":
        o = agents[ev["agentId"]]; o.state = "queued" if deps_met(o) else "waiting"
    elif t == "work_delegated":
        f, to = agents[ev["fromId"]], agents[ev["toId"]]
        if f.state in ("queued", "waiting", None) : f.state = "working"
        delegations.append((ev["fromId"], ev["toId"]))
        if f.state not in ("blocked", "failed", "done"): f.state = "working"
    elif t == "tool_called":
        o = agents[ev["agentId"]]
        if o.state in ("queued", "waiting", "failed"): o.state = "working"
        o.tool = ev["tool"]
    elif t == "message_sent": messages.append((ev["fromId"], ev["toId"], ev["text"]))
    elif t == "agent_blocked":
        o = agents[ev["agentId"]]; o.state = "blocked"; o.reason = ev["reason"]
    elif t == "agent_unblocked": agents[ev["agentId"]].state = "working"
    elif t == "agent_failed":
        o = agents[ev["agentId"]]; o.state = "failed"; o.error = ev["error"]
    elif t == "agent_retry": agents[ev["agentId"]].state = "working"
    elif t == "output_produced": agents[ev["agentId"]].outputs.append(ev["name"])
    elif t == "agent_completed":
        agents[ev["agentId"]].state = "done"
        for o in agents.values():
            if o.state == "waiting" and deps_met(o): o.state = "queued"
S = agents
counts = collections.Counter(o.state for o in S.values())
TOTAL = len(S); DONE = counts["done"]; PCT = round(100 * DONE / TOTAL)
DEPS = [(d, o.id) for o in S.values() for d in o.deps]            # (from, to): "to waits for from"
TOP = [o.id for o in S.values() if o.parent == "orch"]
PLAIN = {"working": "working", "waiting": "waiting", "blocked": "blocked", "failed": "failed", "done": "done", "queued": "queued"}

def f(x):
    s = f"{x:.1f}"
    return s[:-2] if s.endswith(".0") else s

# ---------------- tiny SVG builder that merges same-style shapes ----------------
class C:
    def __init__(s): s.g = collections.OrderedDict(); s.texts = []; s.raw = []
    def add(s, d, z=1, stroke="none", sw=1, fill="none", dash=None, op=None, cap=None, fop=None):
        s.g.setdefault((z, stroke, sw, fill, dash, op, cap, fop), []).append(d)
    def circle_d(s, x, y, r): return f"M{f(x - r)} {f(y)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z"
    def node(s, x, y, state, r=7):
        d = s.circle_d(x, y, r); k = r / 7.0
        if state == "working":
            s.add(s.circle_d(x, y, r + 7), 5, ACC, 1, op=0.35)
            s.add(d, 6, BG, 2, ACC)
        elif state == "waiting":
            s.add(d, 6, INK, 1.5, BG, dash="2.5 2.5")
        elif state == "queued":
            s.add(d, 6, MIST, 1.5, BG)
        elif state == "blocked":
            s.add(s.circle_d(x, y, r + 5), 5, AMB, 1, op=0.4)
            s.add(d, 6, BG, 2, AMB)
            s.add(f"M{f(x - 2 * k)} {f(y - 3 * k)}v{f(6 * k)}M{f(x + 2 * k)} {f(y - 3 * k)}v{f(6 * k)}", 7, BG, 1.8, cap="round")
        elif state == "failed":
            s.add(d, 6, BG, 2, RUST)
            s.add(f"M{f(x - 2.6 * k)} {f(y - 2.6 * k)}l{f(5.2 * k)} {f(5.2 * k)}M{f(x + 2.6 * k)} {f(y - 2.6 * k)}l{f(-5.2 * k)} {f(5.2 * k)}", 7, BG, 1.8, cap="round")
        elif state == "done":
            s.add(d, 6, BG, 2, INK)
            s.add(f"M{f(x - 3 * k)} {f(y + 0.4 * k)}l{f(2.2 * k)} {f(2.4 * k)}l{f(4 * k)} {f(-5 * k)}", 7, BG, 1.8, cap="round")
    def doc(s, x, y):  # output glyph, top-left at x,y
        s.add(f"M{f(x)} {f(y)}h8l4 4v11h-12z", 8, ACC, 1.3, BG)
        s.add(f"M{f(x + 8)} {f(y)}v4h4", 8, ACC, 1.3)
    def text(s, x, y, t, anchor="middle", fill=INK, size=12, weight=None, font="Menlo", ls=1.2):
        w = f' font-weight="{weight}"' if weight else ""
        s.texts.append(f'<text x="{f(x)}" y="{f(y)}" font-family="{font}" font-size="{size}" letter-spacing="{ls}"{w} text-anchor="{anchor}" fill="{fill}" stroke="{BG}" stroke-width="3" paint-order="stroke">{t}</text>')
    def tag(s, x, y, t, col, anchor="middle"):
        w = 7.4 * len(t) + 14
        x0 = x - w / 2 if anchor == "middle" else (x if anchor == "start" else x - w)
        s.raw.append(f'<rect x="{f(x0)}" y="{f(y - 13)}" width="{f(w)}" height="19" rx="9.5" fill="{col}"/>')
        s.texts.append(f'<text x="{f(x0 + w / 2)}" y="{f(y + 0.5)}" font-family="Menlo" font-size="12" letter-spacing="0.6" text-anchor="middle" fill="#FFFFFF">{t}</text>')
    def chip(s, x, y, t, anchor="middle"):
        w = 7.4 * len(t) + 12
        x0 = x - w / 2 if anchor == "middle" else (x if anchor == "start" else x - w)
        s.raw.append(f'<rect x="{f(x0)}" y="{f(y - 12)}" width="{f(w)}" height="18" rx="4" fill="{BG}" stroke="{ACC}" stroke-width="1"/>')
        s.texts.append(f'<text x="{f(x0 + w / 2)}" y="{f(y + 1)}" font-family="Menlo" font-size="12" letter-spacing="0.4" text-anchor="middle" fill="{ACC}">{t}</text>')
    def arc_progress(s, x, y, r, pct, sx=1.0):
        # ring with progress arc from top, clockwise
        s.raw.append(f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(r * sx)}" ry="{f(r)}" stroke="{MIST}" stroke-width="4" fill="none"/>')
        a = 2 * math.pi * pct / 100
        x1, y1 = x + r * sx * math.sin(a), y - r * math.cos(a)
        large = 1 if pct > 50 else 0
        s.raw.append(f'<path d="M{f(x)} {f(y - r)}A{f(r * sx)} {f(r)} 0 {large} 1 {f(x1)} {f(y1)}" stroke="{ACC}" stroke-width="4" fill="none" stroke-linecap="round"/>')
    def render(s, w=W, h=H):
        out = [f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" fill="none" xmlns="http://www.w3.org/2000/svg">']
        items = []
        for (z, stroke, sw, fill, dash, op, cap, fop), ds in s.g.items():
            a = f'd="{"".join(ds)}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}"'
            if dash: a += f' stroke-dasharray="{dash}"'
            if op is not None: a += f' opacity="{op}"'
            if cap: a += f' stroke-linecap="{cap}" stroke-linejoin="round"'
            if fop is not None: a += f' fill-opacity="{fop}"'
            items.append((z, f"<path {a}/>"))
        # raw (rects, ellipses) at z=4 under nodes, texts on top
        out += [x for _, x in sorted(items, key=lambda t: t[0]) if _ < 5]
        out += s.raw
        out += [x for _, x in sorted(items, key=lambda t: t[0]) if _ >= 5]
        out += s.texts
        out.append("</svg>")
        return "".join(out)

def shorten(p, q, a, b):
    dx, dy = q[0] - p[0], q[1] - p[1]; L = math.hypot(dx, dy) or 1
    return (p[0] + dx / L * a, p[1] + dy / L * a), (q[0] - dx / L * b, q[1] - dy / L * b)
def line_d(p, q, a=9, b=9):
    p2, q2 = shorten(p, q, a, b); return f"M{f(p2[0])} {f(p2[1])}L{f(q2[0])} {f(q2[1])}"
def curve_d(p, q, pull=0.3, center=(CX, CY), a=9, b=9):
    p2, q2 = shorten(p, q, a, b)
    mx, my = (p2[0] + q2[0]) / 2, (p2[1] + q2[1]) / 2
    cx_, cy_ = mx + (center[0] - mx) * pull, my + (center[1] - my) * pull
    return f"M{f(p2[0])} {f(p2[1])}Q{f(cx_)} {f(cy_)} {f(q2[0])} {f(q2[1])}"
def packet(c, p, q, t=0.5):
    c.add(c.circle_d(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 3.5), 7, BG, 1.8, ACC)
def rpoly(pts, r=12):
    d = f"M{f(pts[0][0])} {f(pts[0][1])}"
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        rr = min(r, math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2, math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2)
        def toward(a, b, dist):
            L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            return a[0] + (b[0] - a[0]) / L * dist, a[1] + (b[1] - a[1]) / L * dist
        a_ = toward(p1, p0, rr); b_ = toward(p1, p2, rr)
        d += f"L{f(a_[0])} {f(a_[1])}Q{f(p1[0])} {f(p1[1])} {f(b_[0])} {f(b_[1])}"
    return d + f"L{f(pts[-1][0])} {f(pts[-1][1])}"

def call_outs(c, pos, dx=0, dy=22, anchors=None):
    """amber/rust tags under blocked/failed agents, tool chips for working ones"""
    for aid, o in S.items():
        if aid not in pos: continue
        x, y = pos[aid]; ox, oy = (anchors or {}).get(aid, (dx, dy))
        if o.state == "blocked": c.tag(x + ox, y + oy, "NEEDS APPROVAL", AMB)
        elif o.state == "failed": c.tag(x + ox, y + oy, "2 TESTS FAILED · RETRY", RUST)
        elif o.state == "working" and o.tool: c.chip(x + ox, y + oy, o.tool)

def done_outputs(c, pos, off=(9, -25)):
    for aid, o in S.items():
        if aid in pos and o.outputs:
            for i, _ in enumerate(o.outputs):
                c.doc(pos[aid][0] + off[0] + i * 16, pos[aid][1] + off[1])

# ===================================================================== BOARD 1: ORB WEB
def board1():
    c = C(); sx = 1.28
    ang = {"plan": -90, "res": -38.6, "code": 12.9, "test": 64.3, "write": 115.7, "rev": 167.1, "ship": 218.6}
    R1, R2 = 165, 292
    def P(r, a): return (CX + r * sx * math.cos(math.radians(a)), CY + r * math.sin(math.radians(a)))
    pos = {"orch": (CX, CY)}
    for k, a in ang.items(): pos[k] = P(R1, a)
    for k, da in (("web", -15), ("docs", 0), ("diff", 15)): pos[k] = P(R2, ang["res"] + da)
    pos["lint"] = P(R2, ang["code"])
    # web threads
    names = list(ang.values())
    for rr in (70, 200, 300):
        pts = [P(rr, a) for a in sorted(names)]
        d = ""
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            d += (f"M{f(p[0])} {f(p[1])}" if i == 0 else "") + f"Q{f(mx + (CX - mx) * 0.12)} {f(my + (CY - my) * 0.12)} {f(q[0])} {f(q[1])}"
        c.add(d, 1, MIST, 1, op=0.7)
    # delegation spokes
    for aid, o in S.items():
        if o.parent and o.parent in pos: c.add(line_d(pos[o.parent], pos[aid], 14 if o.parent == "orch" else 9, 9), 2, INK, 1.25)
    # dependencies (dashed) and messages (dotted)
    for a, b in DEPS: c.add(curve_d(pos[a], pos[b], 0.45), 2, SLATE, 1.5, dash="5 4")
    for a, b, _ in messages: c.add(curve_d(pos[a], pos[b], 0.25), 3, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.55)
    c.arc_progress(CX, CY, 40, PCT)
    for aid, p in pos.items():
        c.node(p[0], p[1], S[aid].state, 12 if aid == "orch" else (8 if S[aid].parent == "orch" else 6))
    done_outputs(c, pos)
    for aid, p in pos.items():
        if aid == "orch": continue
        a = math.atan2(p[1] - CY, (p[0] - CX) / sx)
        lx, ly = p[0] + math.cos(a) * 22, p[1] + math.sin(a) * 18 + 4
        anc = "start" if lx > CX + 4 else "end" if lx < CX - 4 else "middle"
        if anc == "start" and lx > 735: lx, ly, anc = p[0] - 14, p[1] + 22, "end"
        c.text(lx, ly, S[aid].label, anc, INK)
    c.text(CX, CY - 56, f"TASK · {PCT}%", "middle", ACC)
    c.text(CX, CY + 66, "ORCH", "middle", INK)
    call_outs(c, {k: v for k, v in pos.items() if k != "orch"}, 0, 36)
    return c

# ===================================================================== BOARD 2: HIVE CELLS
def hexd(x, y, r):
    return "M" + "L".join(f"{f(x + r * math.cos(math.pi / 6 + k * math.pi / 3))} {f(y + r * math.sin(math.pi / 6 + k * math.pi / 3))}" for k in range(6)) + "Z"
def board2():
    c = C(); R = 44; w = math.sqrt(3) * R
    pos = {"orch": (CX, CY), "plan": (CX - w / 2, CY - 1.5 * R), "res": (CX + w / 2, CY - 1.5 * R), "code": (CX + w, CY),
           "test": (CX + w / 2, CY + 1.5 * R), "write": (CX - w / 2, CY + 1.5 * R), "rev": (CX - w, CY), "ship": (CX - 2 * w, CY)}
    def sat(parent, ang, dist=80): return (pos[parent][0] + dist * math.cos(math.radians(ang)), pos[parent][1] + dist * math.sin(math.radians(ang)))
    pos["web"] = sat("res", -100); pos["docs"] = sat("res", -50); pos["diff"] = sat("res", 0, 84); pos["lint"] = sat("code", 20)
    # faint comb for context
    comb = ""
    for r_ in range(-4, 5):
        for q in range(-7, 8):
            x = CX + q * w + (w / 2 if r_ % 2 else 0); y = CY + r_ * 1.5 * R
            if 40 < x < W - 40 and 40 < y < H - 40 and all(math.hypot(x - p[0], y - p[1]) > 50 for p in pos.values()):
                comb += hexd(x, y, R - 2)
    c.add(comb, 1, MIST, 1, op=0.55)
    for aid, o in S.items():
        x, y = pos[aid]; r = R - 2 if aid in TOP + ["orch"] else 25
        st = o.state; col = STATE_COL[st]
        if st == "waiting": c.add(hexd(x, y, r), 3, INK, 1.5, dash="4 3")
        elif st == "done": c.add(hexd(x, y, r), 3, INK, 1.5, INK, fop=0.1)
        elif st == "working": c.add(hexd(x, y, r), 3, ACC, 2, ACC, fop=0.16); c.add(hexd(x, y, r - 8), 3, ACC, 1.2, op=0.6)
        elif st == "blocked": c.add(hexd(x, y, r), 3, AMB, 2, AMB, fop=0.2)
        elif st == "failed": c.add(hexd(x, y, r), 3, RUST, 2, RUST, fop=0.18)
        else: c.add(hexd(x, y, r), 3, MIST, 1.5)
    for aid, o in S.items():
        if o.parent and o.parent != "orch": c.add(line_d(pos[o.parent], pos[aid], 16, 12), 2, INK, 1.25)
    for a, b in DEPS:
        if S[a].parent == "orch" and S[b].parent == "orch" or (a in ("lint",)): c.add(line_d(pos[a], pos[b], 30 if a in TOP else 14, 30), 4, SLATE, 1.5, dash="5 4")
    for a, b, _ in messages: c.add(line_d(pos[a], pos[b], 14, 14), 4, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    c.arc_progress(CX, CY, 58, PCT)
    for aid, p in pos.items():
        big = aid in TOP + ["orch"]
        c.node(p[0], p[1] + (14 if big else 6), S[aid].state, 6 if big else 5)
        c.text(p[0], p[1] - (2 if big else 6), S[aid].label if big else S[aid].label, "middle", INK, 12 if big else 11)
    done_outputs(c, {k: (v[0] + 4, v[1] + 8) for k, v in pos.items()}, (10, -2))
    c.text(CX, CY - 72, f"TASK · {PCT}%", "middle", ACC)
    call_outs(c, pos, 0, 62, {"code": (36, 56), "test": (24, 62), "write": (-24, 62), "rev": (-30, 62), "res": (46, -58), "orch": (0, 112), "diff": (58, 0), "web": (-40, -40), "docs": (46, -40), "ship": (0, 56), "lint": (30, 40)})
    return c

# ===================================================================== BOARD 3: RADAR
def board3():
    c = C(); R = 318; r1, r2 = 128, 240
    def P(r, a): return (CX + r * math.cos(math.radians(a - 90)), CY + r * math.sin(math.radians(a - 90)))
    ang = {"plan": -28, "res": 30, "code": 92, "test": 144, "write": 192, "rev": 238, "ship": 285}
    pos = {"orch": (CX, CY)}
    for k, a in ang.items(): pos[k] = P(r1, a)
    for k, da in (("web", -18), ("docs", 0), ("diff", 18)): pos[k] = P(r2, ang["res"] + da)
    pos["lint"] = P(r2, ang["code"])
    for r in (r1, r2): c.add(c.circle_d(CX, CY, r), 1, MIST, 1)
    c.raw.append(f'<circle cx="{CX}" cy="{CY}" r="{R}" stroke="{MIST}" stroke-width="5" fill="none"/>')
    a = 2 * math.pi * PCT / 100
    ex, ey = CX + R * math.sin(a), CY - R * math.cos(a)
    c.raw.append(f'<path d="M{CX} {CY - R}A{R} {R} 0 0 1 {f(ex)} {f(ey)}" stroke="{ACC}" stroke-width="5" fill="none" stroke-linecap="round"/>')
    tk = ""
    for d in range(0, 360, 10):
        L = 10 if d % 30 == 0 else 5; x1, y1 = P(R - 9, d); x2, y2 = P(R - 9 - L, d); tk += f"M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}"
    c.add(tk, 1, INK, 1)
    sp = "".join(f"M{CX} {CY}L{f(P(R - 20, d)[0])} {f(P(R - 20, d)[1])}" for d in range(0, 360, 30))
    c.add(sp, 1, MIST, 1, op=0.6)
    # sweep wedge
    x0, y0 = P(R - 22, 55); x1, y1 = P(R - 22, 115)
    c.add(f"M{CX} {CY}L{f(x0)} {f(y0)}A{R - 22} {R - 22} 0 0 1 {f(x1)} {f(y1)}Z", 1, "none", 1, ACC, fop=0.08)
    for aid, o in S.items():
        if o.parent and o.parent in pos: c.add(line_d(pos[o.parent], pos[aid], 14 if o.parent == "orch" else 9, 9), 2, INK, 1.25)
    for a_, b in DEPS: c.add(curve_d(pos[a_], pos[b], 0.5), 2, SLATE, 1.5, dash="5 4")
    for a_, b, _ in messages: c.add(curve_d(pos[a_], pos[b], 0.2), 3, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    for aid, o in S.items():  # trails for working agents
        if o.state == "working" and aid != "orch":
            rr = math.hypot(pos[aid][0] - CX, pos[aid][1] - CY); an = math.degrees(math.atan2(pos[aid][1] - CY, pos[aid][0] - CX)) + 90
            p0 = P(rr, an - 22); p1 = P(rr, an)
            c.add(f"M{f(p0[0])} {f(p0[1])}A{f(rr)} {f(rr)} 0 0 1 {f(p1[0])} {f(p1[1])}", 3, ACC, 3, op=0.5, cap="round")
    for aid, p in pos.items(): c.node(p[0], p[1], S[aid].state, 12 if aid == "orch" else (8 if S[aid].parent == "orch" else 6))
    done_outputs(c, pos)
    for aid, p in pos.items():
        if aid == "orch": continue
        a_ = math.atan2(p[1] - CY, p[0] - CX); c.text(p[0] + math.cos(a_) * 24, p[1] + math.sin(a_) * 20 + 4, S[aid].label, "middle", INK)
    c.text(CX, CY + 30, "ORCH", "middle", INK); c.text(CX + 8, CY - r1 + 18, "DEPTH 1", "start", SLATE); c.text(CX + 8, CY - r2 + 18, "DEPTH 2", "start", SLATE)
    c.text(CX, 14, f"TASK · {PCT}%", "middle", ACC)
    call_outs(c, {k: v for k, v in pos.items() if k != "orch"}, 0, 38, {"write": (0, 32), "rev": (-10, 32), "code": (0, 34), "test": (6, 34)})
    return c

# ===================================================================== BOARD 4: ROUTED LATTICE
def board4():
    c = C()
    for yy in range(26, 680, 34):
        for xx in range(26, 804, 34): c.add(f"M{xx} {yy}h0", 0, MIST, 2.4, cap="round", op=0.8)
    pos = {"orch": (60, 340), "plan": (170, 340), "res": (300, 200), "web": (450, 110), "docs": (450, 170), "diff": (450, 230),
           "code": (300, 470), "lint": (450, 540), "test": (560, 470), "write": (600, 300), "rev": (690, 300), "ship": (760, 300)}
    # delegation bus top and bottom
    top_y, bot_y = 38, 640
    c.add(rpoly([pos["orch"], (60, top_y), (760, top_y)], 12), 2, SLATE, 1.25)
    for k in ("plan", "res", "write", "rev", "ship"): c.add(f"M{pos[k][0]} {top_y}L{pos[k][0]} {pos[k][1] - 10}", 2, SLATE, 1.25)
    c.add(rpoly([(60, 340), (60, bot_y), (560, bot_y)], 12), 2, SLATE, 1.25)
    for k in ("code", "test"): c.add(f"M{pos[k][0]} {bot_y}L{pos[k][0]} {pos[k][1] + 10}", 2, SLATE, 1.25)
    for aid in ("web", "docs", "diff"): c.add(rpoly([pos["res"], (370, pos["res"][1]), (370, pos[aid][1]), pos[aid]], 10), 2, SLATE, 1.25)
    c.add(rpoly([pos["code"], (370, pos["code"][1]), (370, pos["lint"][1]), pos["lint"]], 10), 2, SLATE, 1.25)
    # dependencies
    c.add(rpoly([pos["plan"], (235, pos["plan"][1]), (235, pos["res"][1]), pos["res"]], 12), 3, SLATE, 1.6, dash="6 4")
    c.add(rpoly([pos["plan"], (235, pos["plan"][1]), (235, pos["code"][1]), pos["code"]], 12), 3, SLATE, 1.6, dash="6 4")
    c.add(rpoly([pos["lint"], (505, pos["lint"][1]), (505, pos["test"][1]), pos["test"]], 12), 3, SLATE, 1.6, dash="6 4")
    c.add(rpoly([pos["res"], (540, pos["res"][1]), (540, 290), pos["write"]], 12), 3, SLATE, 1.6, dash="6 4")
    c.add(rpoly([pos["test"], (600, pos["test"][1]), pos["write"]], 12), 3, SLATE, 1.6, dash="6 4")
    c.add(f"M{pos['write'][0]} {pos['write'][1]}L{pos['rev'][0]} {pos['rev'][1]}", 3, SLATE, 1.6, dash="6 4")
    c.add(f"M{pos['rev'][0]} {pos['rev'][1]}L{pos['ship'][0]} {pos['ship'][1]}", 3, SLATE, 1.6, dash="6 4")
    # messages: web->res, res->code, test->code (green, with packets)
    c.add(rpoly([pos["web"], (395, pos["web"][1]), (395, pos["res"][1] + 12), (pos["res"][0] + 12, pos["res"][1] + 12)], 10), 4, ACC, 2.2)
    c.add(rpoly([(pos["res"][0] - 12, pos["res"][1] + 8), (pos["res"][0] - 12, pos["code"][1] - 8)], 10), 4, ACC, 2.2)
    c.add(rpoly([(pos["test"][0] - 10, pos["test"][1] + 12), (pos["test"][0] - 10, 505), (pos["code"][0] + 14, 505), (pos["code"][0] + 14, pos["code"][1] + 10)], 10), 4, ACC, 2.2)
    for p in ((395, 165), (288, 335), (400, 505)): c.add(c.circle_d(p[0], p[1], 3.6), 7, BG, 1.8, ACC)
    for aid, p in pos.items(): c.node(p[0], p[1], S[aid].state, 11 if aid == "orch" else (8 if S[aid].parent == "orch" else 6))
    done_outputs(c, pos, (12, -26))
    for aid, p in pos.items():
        dy = 26 if aid not in ("web", "docs", "diff", "lint") else 5
        dx = 0 if aid not in ("web", "docs", "diff", "lint") else 18
        c.text(p[0] + dx, p[1] + dy, S[aid].label, "middle" if dx == 0 else "start", INK)
    c.text(60, 392, f"TASK · {PCT}%", "middle", ACC)
    call_outs(c, pos, 0, 52, {"code": (0, 54), "test": (0, 54), "diff": (96, 5), "orch": (0, -40), "lint": (88, 5), "docs": (100, 5), "web": (100, 5), "res": (0, -34)})
    return c

# ===================================================================== BOARD 5: CONTRIBUTION RIVER (sankey)
def board5():
    c = C()
    effort = {"plan": 3.0, "web": 3.0, "docs": 3.2, "diff": 8.0, "code": 8.0, "res": 2.0, "lint": 1.0, "test": 4.6, "write": 3.0, "rev": 2.0, "ship": 2.0}
    cols = {"plan": 0, "web": 1, "docs": 1, "diff": 1, "code": 1, "res": 2, "lint": 2, "test": 3, "write": 4, "rev": 5, "ship": 6, "release": 7}
    flows = [("plan", "web", 1.0), ("plan", "docs", 1.0), ("plan", "diff", 1.0), ("plan", "code", 1.0), ("web", "res", 1.0), ("docs", "res", 1.0), ("diff", "res", 1.0),
             ("code", "lint", 1.0), ("lint", "test", 1.0), ("res", "write", 1.0), ("test", "write", 1.0), ("write", "rev", 1.0), ("rev", "ship", 1.0), ("ship", "release", 1.0)]
    xs = {0: 40, 1: 160, 2: 340, 3: 470, 4: 560, 5: 650, 6: 725, 7: 780}
    bw = 12
    order = {0: ["plan"], 1: ["web", "docs", "diff", "code"], 2: ["res", "lint"], 3: ["test"], 4: ["write"], 5: ["rev"], 6: ["ship"], 7: ["release"]}
    scale = 15.0
    height = {k: max(effort.get(k, 2.0) * 1.4, 14) for k in cols}
    height["release"] = 40
    ytop = {}
    gap = 26
    for col, ks in order.items():
        tot = sum(height[k] for k in ks) + gap * (len(ks) - 1); y = 120 + (480 - tot) / 2 if col not in (0,) else 300
        if col == 1: y = 105
        if col == 2: y = 150
        if col == 3: y = 440
        if col == 4: y = 300
        if col == 5: y = 300
        if col == 6: y = 300
        if col == 7: y = 290
        for k in ks: ytop[k] = y; y += height[k] + gap
    ytop["res"] = 150; ytop["lint"] = 470; ytop["code"] = 440; ytop["docs"] = 180; ytop["web"] = 105; ytop["diff"] = 255; ytop["test"] = 470
    # ribbons
    outoff = collections.defaultdict(float); inoff = collections.defaultdict(float)
    for a, b, v in flows:
        wd = min(height[a], height[b]) / max(1, sum(1 for x in flows if x[0] == a)) if False else None
    def split(k, kind):
        n = sum(1 for x in flows if (x[0] if kind == "out" else x[1]) == k); return height[k] / max(n, 1)
    for a, b, v in flows:
        wa = split(a, "out"); wb = split(b, "in"); wd = min(wa, wb)
        ya = ytop[a] + outoff[a]; yb = ytop[b] + inoff[b]; outoff[a] += wa; inoff[b] += wb
        xa, xb = xs[cols[a]] + bw, xs[cols[b]]
        mx = (xa + xb) / 2
        d = f"M{f(xa)} {f(ya)}C{f(mx)} {f(ya)} {f(mx)} {f(yb)} {f(xb)} {f(yb)}L{f(xb)} {f(yb + wd)}C{f(mx)} {f(yb + wd)} {f(mx)} {f(ya + wd)} {f(xa)} {f(ya + wd)}Z"
        st = S[a].state if a in S else "waiting"
        if st == "done": c.add(d, 2, INK, 1, INK, fop=0.14)
        elif st == "working": c.add(d, 2, ACC, 1, ACC, fop=0.22)
        elif st == "blocked": c.add(d, 2, AMB, 1, AMB, fop=0.22)
        elif st == "failed": c.add(d, 2, RUST, 1, RUST, fop=0.2)
        else: c.add(d, 2, INK, 1, dash="4 3", op=0.7)
    pos = {}
    for k in cols:
        x = xs[cols[k]]; y = ytop[k]; h = height[k]
        st = S[k].state if k in S else "waiting"
        if k == "release":
            c.add(f"M{x} {y}h{bw}v{h}h{-bw}z", 3, INK, 1.5, dash="3 3")
        elif st == "waiting": c.add(f"M{x} {y}h{bw}v{h}h{-bw}z", 3, INK, 1.5, BG, dash="3 3")
        else: c.add(f"M{x} {y}h{bw}v{h}h{-bw}z", 3, STATE_COL[st], 1, STATE_COL[st])
        pos[k] = (x + bw / 2, y + h / 2)
    # state glyphs on bars
    for k in cols:
        if k == "release": continue
        c.node(pos[k][0], pos[k][1], S[k].state, 5)
    # labels
    for k, (x, y) in pos.items():
        lab = S[k].label if k in S else "RELEASE"
        left = k in ("plan",)
        c.text(xs[cols[k]] + bw / 2, ytop[k] - 9, lab, "middle", INK)
    # blocked dam + failure eddy callouts
    cy = ytop["code"] + height["code"] / 2
    c.tag(xs[1] + 6, ytop["code"] + height["code"] + 32, "NEEDS APPROVAL", AMB)
    c.tag(xs[3] + 6, ytop["test"] + height["test"] + 32, "2 TESTS FAILED · RETRY", RUST)
    c.chip(xs[1] + 6, ytop["diff"] + height["diff"] + 20, "git_log")
    # outputs
    for k in ("plan", "web"):
        c.doc(xs[cols[k]] + bw + 4, ytop[k] - 4)
    c.text(xs[7] + 6, ytop["release"] + height["release"] + 22, "FINAL OUTPUT", "middle", SLATE)
    c.text(CX, 30, f"EFFORT DELIVERED · {PCT}% OF AGENTS DONE", "middle", ACC)
    c.text(xs[0], 270, "PLAN", "middle", INK) if False else None
    return c

# ===================================================================== BOARD 6: FLOORPLAN
def board6():
    c = C()
    def room(x, y, w, h, name):
        c.raw.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" stroke="{INK}" stroke-width="2" fill="#F1EFE8"/>')
        c.text(x + 14, y + 22, name, "start", SLATE)
    room(20, 40, 240, 190, "COMMAND"); room(300, 40, 484, 270, "RESEARCH LAB"); room(20, 270, 240, 380, "BUILD BAY")
    room(300, 350, 300, 300, "STUDIO"); room(640, 350, 144, 300, "DOCK")
    # corridors/doors
    for x, y, w, h in ((260, 100, 40, 14), (260, 400, 40, 14), (600, 480, 40, 14), (110, 230, 14, 40)):
        c.raw.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{BG}"/>')
    pos = {"orch": (140, 130), "plan": (140, 180), "res": (400, 140), "web": (500, 110), "docs": (600, 110), "diff": (700, 110),
           "code": (90, 360), "lint": (190, 360), "test": (140, 520), "write": (380, 470), "rev": (500, 470), "ship": (712, 470)}
    pos["plan"] = (210, 190); pos["orch"] = (80, 130)
    for aid, o in S.items():
        if o.parent == "orch" and aid in pos: c.add(line_d(pos["orch"], pos[aid], 14, 10), 1, MIST, 1.2, dash="2 4") if False else None
    for a, b in DEPS: c.add(curve_d(pos[a], pos[b], 0.0), 2, SLATE, 1.6, dash="5 4")
    for a, b, _ in messages: c.add(curve_d(pos[a], pos[b], 0.12), 3, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    # desks
    for aid, p in pos.items():
        c.raw.append(f'<rect x="{f(p[0] - 22)}" y="{f(p[1] + 8)}" width="44" height="18" rx="4" fill="{BG}" stroke="{MIST}" stroke-width="1.5"/>')
    for aid, p in pos.items(): c.node(p[0], p[1], S[aid].state, 10 if aid in TOP + ["orch"] else 7)
    for aid, p in pos.items(): c.text(p[0], p[1] + 44 if False else p[1] + 42, S[aid].label, "middle", INK)
    for aid, p in pos.items():
        for i, _ in enumerate(S[aid].outputs): c.doc(p[0] + 26 + i * 16, p[1] + 6)
    # outbox
    c.raw.append(f'<rect x="660" y="540" width="100" height="40" rx="6" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>')
    c.text(710, 565, "OUTBOX", "middle", SLATE)
    # progress clock
    c.arc_progress(215, 110, 22, PCT)
    c.text(215, 70, f"TASK {PCT}%", "middle", ACC)
    call_outs(c, pos, 0, 62, {"code": (40, 60), "test": (0, 64), "orch": (0, -34), "res": (0, -34), "diff": (-10, 48), "web": (0, 48), "docs": (0, 48), "lint": (10, 48)})
    return c

# ===================================================================== BOARD 7: SWIMLANES
def board7():
    c = C()
    lanes = ["orch", "plan", "res", "web", "docs", "diff", "code", "lint", "test", "write", "rev", "ship"]
    X0, X1, Y0, LH = 120, 784, 56, 47
    T = META["durationMs"]
    def X(t): return X0 + (X1 - X0) * t / T
    def Y(a): return Y0 + lanes.index(a) * LH + LH / 2
    for i in range(0, 12 + 1):
        c.add(f"M0 {Y0 + i * LH}H{W}", 0, MIST, 1, op=0.6)
    for s_ in range(0, 22, 4):
        c.add(f"M{f(X(s_ * 1000))} {Y0 - 14}V{Y0 + 12 * LH}", 0, MIST, 1, op=0.5)
        c.text(X(s_ * 1000), 22, f"{s_}s", "middle", SLATE)
    for a in lanes: c.text(0, Y(a) + 4, S[a].label, "start", INK)
    # build segments from events (bars)
    seg = collections.defaultdict(list); cur = {}
    state_at = {}
    for ev in EVENTS:
        t = ev["t"]; tp = ev["type"]; aid = ev.get("agentId")
        if tp == "agent_spawned": state_at[ev["agentId"]] = ("waiting", t)
        elif tp == "work_delegated":
            st = state_at.get(ev["fromId"])
            if st and st[0] == "waiting": seg[ev["fromId"]].append((st[1], t, "waiting")); state_at[ev["fromId"]] = ("working", t)
        elif tp == "tool_called" and aid:
            st = state_at.get(aid)
            if st and st[0] in ("waiting", "failed"):
                seg[aid].append((st[1], t, st[0])); state_at[aid] = ("working", t)
        elif tp == "agent_blocked": seg[aid].append((state_at[aid][1], t, state_at[aid][0])); state_at[aid] = ("blocked", t)
        elif tp == "agent_unblocked": seg[aid].append((state_at[aid][1], t, "blocked")); state_at[aid] = ("working", t)
        elif tp == "agent_failed": seg[aid].append((state_at[aid][1], t, state_at[aid][0])); state_at[aid] = ("failed", t)
        elif tp == "agent_retry": seg[aid].append((state_at[aid][1], t, "failed")); state_at[aid] = ("working", t)
        elif tp == "agent_completed": seg[aid].append((state_at[aid][1], t, state_at[aid][0])); state_at[aid] = ("done", t)
    comp = {ev["agentId"]: ev["t"] for ev in EVENTS if ev["type"] == "agent_completed"}
    for a in lanes:
        for t0, t1, st in seg[a]:
            if t1 - t0 < 100: continue
            x0, x1 = X(t0), X(t1); y = Y(a)
            past_end = min(t1, SNAP);
            if st == "waiting": c.add(f"M{f(x0)} {f(y)}H{f(x1)}", 2, MIST, 3, dash="1 5", cap="round")
            else:
                col = {"working": ACC, "blocked": AMB, "failed": RUST}[st]
                live = t0 < SNAP
                if live and t1 > SNAP:  # in progress at the snapshot: solid until now, ghost after
                    c.add(f"M{f(x0)} {f(y - 9)}h{f(X(SNAP) - x0)}v18h{f(-(X(SNAP) - x0))}z", 3, col, 1, col)
                    c.add(f"M{f(X(SNAP))} {f(y - 9)}h{f(x1 - X(SNAP))}v18h{f(-(x1 - X(SNAP)))}z", 3, col, 1.2, dash="3 3", op=0.7)
                elif t1 <= SNAP:
                    fill = INK if st == "working" else col
                    c.add(f"M{f(x0)} {f(y - 9)}h{f(x1 - x0)}v18h{f(-(x1 - x0))}z", 3, fill, 1, fill)
                else:
                    c.add(f"M{f(x0)} {f(y - 9)}h{f(x1 - x0)}v18h{f(-(x1 - x0))}z", 3, col if st != "working" else INK, 1.2, dash="3 3", op=0.6)
    # currently blocked / failed: extend to now
    for a in lanes:
        o = S[a]
        if o.state == "blocked":
            t0 = state_at[a][1] if state_at[a][0] == "blocked" else 9400
            c.add(f"M{f(X(9400))} {f(Y(a) - 9)}h{f(X(SNAP) - X(9400))}v18h{f(-(X(SNAP) - X(9400)))}z", 3, AMB, 1, AMB)
            for i in range(0, int(X(SNAP) - X(9400)), 7): c.add(f"M{f(X(9400) + i)} {f(Y(a) + 9)}l6 -18", 6, BG, 1.2)
    for a in lanes:  # state glyph at the 'now' edge of each lane
        pass
    nx = X(SNAP)
    c.add(f"M{f(nx)} {Y0 - 14}V{Y0 + 12 * LH}", 6, INK, 1.5, dash="4 4")
    c.raw.append(f'<rect x="{f(nx - 24)}" y="{Y0 + 12 * LH + 8}" width="48" height="20" rx="10" fill="{INK}"/>')
    c.texts.append(f'<text x="{f(nx)}" y="{Y0 + 12 * LH + 22}" font-family="Menlo" font-size="12" letter-spacing="1.2" text-anchor="middle" fill="{BG}">NOW</text>')
    # handoffs (delegation) as thin curves; messages as green ticks
    def link(a, t1, b, t2, col, w, dash=None):
        x1, y1, x2, y2 = X(t1), Y(a), X(t2), Y(b); mx = (x1 + x2) / 2
        c.add(f"M{f(x1)} {f(y1)}C{f(mx)} {f(y1)} {f(mx)} {f(y2)} {f(x2)} {f(y2)}", 4, col, w, dash=dash)
    for ev in EVENTS:
        if ev["t"] > SNAP: break
        if ev["type"] == "work_delegated" and ev["toId"] != "orch" and ev["fromId"] != "orch": link(ev["fromId"], ev["t"], ev["toId"], ev["t"] + 350, SLATE, 1.2)
    link("orch", 1400, "plan", 1400 + 300, SLATE, 1.2); link("plan", 3700, "res", 4000, SLATE, 1.2); link("plan", 3700, "code", 4000, SLATE, 1.2)
    for ev in EVENTS:
        if ev["t"] > SNAP: break
        if ev["type"] == "message_sent": link(ev["fromId"], ev["t"], ev["toId"], ev["t"] + 250, ACC, 2.2, "0.1 4")
    for ev in EVENTS:
        if ev["t"] > SNAP: break
        if ev["type"] == "output_produced": c.doc(X(ev["t"]) - 6, Y(ev["agentId"]) - 29)
    # failure marker + retry arrow label
    fx, fy = X(11200), Y("test")
    c.node(fx, fy, "failed", 8)
    c.tag(X(SNAP) + 70, Y("test") + 4, "2 TESTS FAILED · RETRY NEXT", RUST, "start")
    c.tag(X(SNAP) + 62, Y("code") + 4, "NEEDS APPROVAL", AMB, "start")
    c.text(0, 22, f"TASK · {PCT}%", "start", ACC)
    return c

# ===================================================================== BOARD 8: TERRITORIES (voronoi)
def clip(poly, a, b, cc):
    out = []
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        fp, fq = a * p[0] + b * p[1] - cc, a * q[0] + b * q[1] - cc
        if fp <= 0: out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq); out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out
def board8():
    c = C()
    seeds = {"orch": (402, 350), "plan": (130, 190), "res": (400, 110), "code": (140, 520), "test": (410, 600), "write": (660, 480), "rev": (690, 270), "ship": (700, 120)}
    cells = {}
    for k, p in seeds.items():
        poly = [(2, 2), (W - 2, 2), (W - 2, H - 2), (2, H - 2)]
        for k2, q in seeds.items():
            if k2 == k: continue
            poly = clip(poly, q[0] - p[0], q[1] - p[1], (q[0] ** 2 + q[1] ** 2 - p[0] ** 2 - p[1] ** 2) / 2)
        cells[k] = poly
    for k, poly in cells.items():
        d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in poly) + "Z"; st = S[k].state
        if st == "done": c.add(d, 1, INK, 1.5, INK, fop=0.1, cap="round")
        elif st == "working": c.add(d, 1, ACC, 2, ACC, fop=0.14, cap="round")
        elif st == "blocked": c.add(d, 1, AMB, 2, AMB, fop=0.2, cap="round")
        elif st == "failed": c.add(d, 1, RUST, 2, RUST, fop=0.18, cap="round")
        else: c.add(d, 1, INK, 1.5, dash="5 4", cap="round")
    pos = dict(seeds)
    pos["web"] = (330, 70); pos["docs"] = (400, 40) if False else (410, 62); pos["diff"] = (500, 90); pos["lint"] = (205, 570)
    pos["web"] = (310, 64); pos["docs"] = (385, 40); pos["diff"] = (470, 70)
    pos["res"] = (390, 125)
    for aid, o in S.items():
        if o.parent and o.parent != "orch": c.add(line_d(pos[o.parent], pos[aid], 12, 8), 2, INK, 1.25)
    for a, b in DEPS:
        if a in ("lint",): c.add(line_d(pos[a], pos[b], 8, 14), 3, SLATE, 1.6, dash="5 4")
        elif a in pos and b in pos: c.add(line_d(pos[a], pos[b], 14, 14), 3, SLATE, 1.6, dash="5 4")
    for a, b, _ in messages: c.add(line_d(pos[a], pos[b], 12, 12), 4, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    for aid, p in pos.items(): c.node(p[0], p[1], S[aid].state, 10 if aid in TOP + ["orch"] else 6)
    done_outputs(c, pos, (12, -24))
    for aid, p in pos.items():
        if aid in ("web", "docs", "diff", "lint"): c.text(p[0], p[1] + 22 if aid != "lint" else p[1] + 22, S[aid].label, "middle", INK)
        else: c.text(p[0], p[1] + 28, S[aid].label, "middle", INK)
    c.text(W - 14, H - 12, f"MAP CLAIMED · {PCT}%", "end", ACC)
    call_outs(c, pos, 0, 50, {"code": (0, 54), "test": (0, 54), "res": (0, 38), "orch": (0, 58), "diff": (0, 38), "lint": (0, 36)})
    return c

# ===================================================================== BOARD 9: CARD TREE
def board9():
    c = C()
    cw, ch = 226, 50
    rows = [("plan", 0), ("res", 1.5), ("code", 4), ("test", 5.1), ("write", 6.1), ("rev", 7.1), ("ship", 8.1)]
    pos = {"orch": (20, 300 - ch / 2 + 0)}
    X1, X2 = 290, 560; y0 = 40; rh = 64
    ypos = {k: y0 + r * rh for k, r in rows}
    cards = {"orch": (24, 340 - ch / 2)}
    for k, y in ypos.items(): cards[k] = (X1, y)
    for i, k in enumerate(("web", "docs", "diff")): cards[k] = (X2, ypos["res"] - rh + i * rh + 0)
    cards["lint"] = (X2, ypos["code"])
    cards["web"] = (X2, ypos["res"] - 26 - 0); cards["docs"] = (X2, ypos["res"] + 38); cards["diff"] = (X2, ypos["res"] + 102) if False else (X2, ypos["res"] + 102)
    cards["web"] = (X2, ypos["res"] - 26); cards["docs"] = (X2, ypos["res"] + 38); cards["diff"] = (X2, ypos["res"] + 102)
    cards["lint"] = (X2, ypos["code"] + 0)
    # shift later rows down to clear res subtree
    for k in ("code", "test", "write", "rev", "ship"): cards[k] = (X1, ypos[k] + 70)
    cards["lint"] = (X2, cards["code"][1])
    anch = {k: (v[0] + cw / 2, v[1] + ch / 2) for k, v in cards.items()}
    out = lambda k: (cards[k][0] + cw, cards[k][1] + ch / 2)
    inn = lambda k: (cards[k][0], cards[k][1] + ch / 2)
    # delegation elbows (solid)
    for k in TOP:
        p, q = out("orch"), inn(k); mx = (p[0] + q[0]) / 2
        c.add(f"M{f(p[0])} {f(p[1])}H{f(mx)}V{f(q[1])}H{f(q[0])}", 1, SLATE, 1.25)
    for k in ("web", "docs", "diff"):
        p, q = out("res"), inn(k); mx = (p[0] + q[0]) / 2
        c.add(f"M{f(p[0])} {f(p[1])}H{f(mx)}V{f(q[1])}H{f(q[0])}", 1, SLATE, 1.25)
    p, q = out("code"), inn("lint"); c.add(f"M{f(p[0])} {f(p[1])}H{f(q[0])}", 1, SLATE, 1.25)
    # dependencies: dashed arcs in the right gutter (x=810) -> drawn as curves between card right edges
    def arc(a, b, bow):
        p, q = out(a), out(b); c.add(f"M{f(p[0])} {f(p[1])}C{f(p[0] + bow)} {f(p[1])} {f(q[0] + bow)} {f(q[1])} {f(q[0])} {f(q[1])}", 3, SLATE, 1.6, dash="5 4")
    arc("plan", "res", -0);
    c.add(f"M{f(out('plan')[0])} {f(out('plan')[1])}C{f(out('plan')[0] + 30)} {f(out('plan')[1])} {f(out('res')[0] + 30)} {f(out('res')[1])} {f(out('res')[0])} {f(out('res')[1])}", 3, SLATE, 1.6, dash="5 4")
    for a, b, bow in (("plan", "code", 30), ("res", "write", 22), ("test", "write", 22), ("write", "rev", 22), ("rev", "ship", 22)):
        p, q = out(a), out(b); c.add(f"M{f(p[0])} {f(p[1])}C{f(p[0] + bow)} {f(p[1])} {f(q[0] + bow)} {f(q[1])} {f(q[0])} {f(q[1])}", 3, SLATE, 1.6, dash="5 4")
    p, q = out("lint"), (cards["test"][0] + cw, cards["test"][1] + ch / 2)
    c.add(f"M{f(p[0])} {f(p[1])}C{f(p[0] + 40)} {f(p[1])} {f(q[0] + 40)} {f(q[1])} {f(q[0])} {f(q[1])}", 3, SLATE, 1.6, dash="5 4")
    for a, b, _ in messages:
        p, q = out(a), out(b); bow = 50 if a == "web" else 36
        c.add(f"M{f(p[0])} {f(p[1])}C{f(p[0] + bow)} {f(p[1])} {f(q[0] + bow)} {f(q[1])} {f(q[0])} {f(q[1])}", 4, ACC, 2.4, dash="0.1 5", cap="round")
    # cards
    for k, (x, y) in cards.items():
        o = S[k]; col = STATE_COL[o.state]
        if o.state == "waiting": c.raw.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="8" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3" fill="{BG}"/>')
        else:
            c.raw.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="8" stroke="{col}" stroke-width="1.5" fill="#F4F2EC"/>')
        c.raw.append(f'<rect x="{x}" y="{y}" width="8" height="{ch}" rx="3" fill="{col if o.state != "waiting" else BG}"/>')
        c.node(x + 26, y + ch / 2, o.state, 8)
        c.texts.append(f'<text x="{x + 44}" y="{y + 21}" font-family="Menlo" font-weight="700" font-size="13" fill="{INK}">{o.name}</text>')
        sub = {"working": (o.tool or "delegating"), "waiting": "waits for " + ", ".join(S[d].label.lower() for d in o.deps), "blocked": "needs approval", "failed": "2 tests failed · retry", "done": "done", "queued": "queued"}[o.state]
        subc = {"working": ACC, "blocked": AMB, "failed": RUST}.get(o.state, SLATE)
        c.texts.append(f'<text x="{x + 44}" y="{y + 39}" font-family="Menlo" font-size="12" fill="{subc}">{sub}</text>')
        for i, _ in enumerate(o.outputs): c.doc(x + cw - 22 - i * 16, y + 9)
    c.text(24, 340 - ch / 2 - 12, f"TASK · {PCT}%", "start", ACC)
    return c

# ===================================================================== BOARD 10: MESSAGE MATRIX
def board10():
    c = C()
    ids = list(S.keys()); n = len(ids); cell = 43; gap = 2; x0, y0 = 150, 84
    for i, a in enumerate(ids):
        c.text(x0 - 12, y0 + i * cell + cell / 2 + 4, S[a].label, "end", INK)
        c.text(x0 + i * cell + cell / 2, y0 - 12, S[a].label[:3], "middle", SLATE, 12, ls=0.4)
    dg = collections.defaultdict(str);
    msgset = {(a, b) for a, b, _ in messages}; dele = {(o.parent, o.id) for o in S.values() if o.parent}; depset = set(DEPS)
    for i, a in enumerate(ids):
        for j, b in enumerate(ids):
            x, y = x0 + j * cell, y0 + i * cell
            base = f"M{x + gap / 2} {y + gap / 2}h{cell - gap}v{cell - gap}h{-(cell - gap)}z"
            if i == j: c.add(base, 1, "none", 1, STATE_COL[S[a].state] if S[a].state != "waiting" else BG, fop=0.9 if S[a].state != "waiting" else None)
            elif (a, b) in msgset: c.add(base, 1, "none", 1, ACC)
            elif (a, b) in dele: c.add(base, 1, SLATE, 1.5)
            elif (a, b) in depset: c.add(base, 1, SLATE, 1.5, dash="3 3")
            else: c.add(f"M{x + cell / 2} {y + cell / 2}h0", 1, MIST, 2.4, cap="round")
    for i, a in enumerate(ids):
        if S[a].state == "waiting": c.add(f"M{x0 + i * cell + gap / 2} {y0 + i * cell + gap / 2}h{cell - gap}v{cell - gap}h{-(cell - gap)}z", 2, INK, 1.5, dash="3 3")
        c.node(x0 + i * cell + cell / 2, y0 + i * cell + cell / 2, S[a].state, 6) if S[a].state in ("blocked", "failed", "working", "done") else None
    # outputs column
    c.text(x0 + n * cell + 26, y0 - 12, "OUT", "start", SLATE)
    for i, a in enumerate(ids):
        for k, _ in enumerate(S[a].outputs): c.doc(x0 + n * cell + 22 + k * 16, y0 + i * cell + 10)
    # callouts on the right of the matrix
    rx = x0 + n * cell + 20
    ry = y0 + ids.index("code") * cell
    c.tag(rx + 62, y0 + ids.index("code") * cell + cell / 2 + 4, "NEEDS APPROVAL", AMB) if False else None
    c.text(x0 - 12, y0 - 12, "FROM", "end", ACC); c.text(x0 + n * cell / 2, y0 - 34, "TO (RECEIVER)", "middle", ACC)
    c.text(x0, 22, f"TASK · {PCT}% · MESSAGES SO FAR: {len(messages)}", "start", ACC)
    # key blockers listed under the matrix
    c.tag(x0 + 90, y0 + n * cell + 34, "NEEDS APPROVAL · CODE", AMB)
    c.tag(x0 + 290, y0 + n * cell + 34, "2 TESTS FAILED · TEST", RUST)
    return c

# ===================================================================== v2 revisions after QA render
def board2():
    c = C(); R = 56; w = math.sqrt(3) * R
    pos = {"orch": (CX, CY), "plan": (CX - w / 2, CY - 1.5 * R), "res": (CX + w / 2, CY - 1.5 * R), "code": (CX + w, CY),
           "test": (CX + w / 2, CY + 1.5 * R), "write": (CX - w / 2, CY + 1.5 * R), "rev": (CX - w, CY), "ship": (CX - 2 * w, CY)}
    def sat(parent, ang, dist=92): return (pos[parent][0] + dist * math.cos(math.radians(ang)), pos[parent][1] + dist * math.sin(math.radians(ang)))
    pos["web"] = sat("res", -120); pos["docs"] = sat("res", -62); pos["diff"] = sat("res", -8); pos["lint"] = sat("code", 28)
    comb = ""
    for r_ in range(-5, 6):
        for q in range(-8, 9):
            x = CX + q * w + (w / 2 if r_ % 2 else 0); y = CY + r_ * 1.5 * R
            if 40 < x < W - 40 and 40 < y < H - 40 and all(math.hypot(x - p[0], y - p[1]) > 62 for p in pos.values()):
                comb += hexd(x, y, R - 2)
    c.add(comb, 1, MIST, 1, op=0.5)
    for aid, o in S.items():
        x, y = pos[aid]; r = R - 2 if aid in TOP + ["orch"] else 31
        st = o.state
        if st == "waiting": c.add(hexd(x, y, r), 3, INK, 1.5, dash="4 3")
        elif st == "done": c.add(hexd(x, y, r), 3, INK, 1.5, INK, fop=0.1)
        elif st == "working": c.add(hexd(x, y, r), 3, ACC, 2, ACC, fop=0.16); c.add(hexd(x, y, r - 9), 3, ACC, 1.2, op=0.6)
        elif st == "blocked": c.add(hexd(x, y, r), 3, AMB, 2, AMB, fop=0.2)
        elif st == "failed": c.add(hexd(x, y, r), 3, RUST, 2, RUST, fop=0.18)
        else: c.add(hexd(x, y, r), 3, MIST, 1.5)
    for aid, o in S.items():
        if o.parent and o.parent != "orch": c.add(line_d(pos[o.parent], pos[aid], 28, 20), 2, INK, 1.25)
    for a, b in DEPS:
        if (S[a].parent == "orch" and S[b].parent == "orch") or a == "lint": c.add(line_d(pos[a], pos[b], 34 if a in TOP else 18, 34), 4, SLATE, 1.6, dash="5 4")
    for a, b, _ in messages: c.add(line_d(pos[a], pos[b], 22, 22), 4, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    for aid, p in pos.items():
        big = aid in TOP + ["orch"]
        c.node(p[0], p[1] + (12 if big else 8), S[aid].state, 6 if big else 5)
        c.text(p[0], p[1] - (8 if big else 6), S[aid].label, "middle", INK, 12)
    for aid, p in pos.items():
        for i, _ in enumerate(S[aid].outputs): c.doc(p[0] + 20 + i * 16, p[1] + 14 if aid in TOP + ["orch"] else p[1] + 8)
    # progress: a strip of twelve mini cells, one per agent, colored by state
    for i, (aid, o) in enumerate(S.items()):
        x = 34 + i * 26; y = 30
        st = o.state
        if st == "waiting": c.add(hexd(x, y, 11), 3, INK, 1.2, dash="3 2")
        elif st == "done": c.add(hexd(x, y, 11), 3, INK, 1, INK, fop=0.9)
        elif st == "working": c.add(hexd(x, y, 11), 3, ACC, 1, ACC)
        elif st == "blocked": c.add(hexd(x, y, 11), 3, AMB, 1, AMB)
        elif st == "failed": c.add(hexd(x, y, 11), 3, RUST, 1, RUST)
    c.text(34 + 12 * 26, 34, f"TASK · {PCT}%", "start", ACC)
    c.chip(CX, CY + 40, S["orch"].tool)
    c.chip(pos["diff"][0] + 78, pos["diff"][1] + 4, S["diff"].tool, "start") if False else c.chip(pos["diff"][0] + 36, pos["diff"][1] + 5, S["diff"].tool, "start")
    c.tag(pos["code"][0] + 66, pos["code"][1] - 38, "NEEDS APPROVAL", AMB, "start")
    c.tag(pos["test"][0], pos["test"][1] + R + 26, "2 TESTS FAILED · RETRY", RUST)
    return c

def board5():
    c = C()
    cols = {"plan": 0, "web": 1, "docs": 1, "diff": 1, "code": 1, "res": 2, "lint": 2, "test": 3, "write": 4, "rev": 5, "ship": 6, "release": 7}
    flows = [("plan", "web"), ("plan", "docs"), ("plan", "diff"), ("plan", "code"), ("web", "res"), ("docs", "res"), ("diff", "res"),
             ("code", "lint"), ("lint", "test"), ("res", "write"), ("test", "write"), ("write", "rev"), ("rev", "ship"), ("ship", "release")]
    xs = {0: 24, 1: 170, 2: 360, 3: 480, 4: 568, 5: 640, 6: 700, 7: 745}
    bw = 14
    height = {"plan": 70, "web": 34, "docs": 34, "diff": 66, "code": 70, "res": 90, "lint": 24, "test": 56, "write": 48, "rev": 34, "ship": 34, "release": 70}
    ytop = {"plan": 270, "web": 62, "docs": 120, "diff": 178, "code": 430, "res": 120, "lint": 450, "test": 436, "write": 280, "rev": 288, "ship": 288, "release": 270}
    outoff = collections.defaultdict(float); inoff = collections.defaultdict(float)
    def split(k, kind):
        n = sum(1 for x in flows if (x[0] if kind == "out" else x[1]) == k); return height[k] / max(n, 1)
    for a, b in flows:
        wa, wb = split(a, "out"), split(b, "in"); wd = min(wa, wb)
        ya = ytop[a] + outoff[a]; yb = ytop[b] + inoff[b]; outoff[a] += wa; inoff[b] += wb
        xa, xb = xs[cols[a]] + bw, xs[cols[b]]; mx = (xa + xb) / 2
        d = f"M{f(xa)} {f(ya)}C{f(mx)} {f(ya)} {f(mx)} {f(yb)} {f(xb)} {f(yb)}L{f(xb)} {f(yb + wd)}C{f(mx)} {f(yb + wd)} {f(mx)} {f(ya + wd)} {f(xa)} {f(ya + wd)}Z"
        st = S[a].state
        if st == "done": c.add(d, 2, INK, 1, INK, fop=0.14)
        elif st == "working": c.add(d, 2, ACC, 1, ACC, fop=0.24)
        elif st == "blocked": c.add(d, 2, AMB, 1, AMB, fop=0.26)
        elif st == "failed": c.add(d, 2, RUST, 1, RUST, fop=0.24)
        else: c.add(d, 2, INK, 1.2, dash="4 3", op=0.7)
    pos = {}
    for k in cols:
        x = xs[cols[k]]; y = ytop[k]; h = height[k]
        st = S[k].state if k in S else "waiting"
        bar = f"M{x} {y}h{bw}v{h}h{-bw}z"
        if k == "release": c.add(bar, 3, INK, 1.5, dash="3 3")
        elif st == "waiting": c.add(bar, 3, INK, 1.5, BG, dash="3 3")
        else: c.add(bar, 3, STATE_COL[st], 1, STATE_COL[st])
        pos[k] = (x + bw / 2, y + h / 2)
    for k in cols:
        if k != "release": c.node(pos[k][0], pos[k][1], S[k].state, 5)
    for k in cols:
        lab = S[k].label if k in S else "RELEASE"
        c.text(xs[cols[k]] + bw / 2, ytop[k] - 9, lab, "middle", INK)
    c.tag(xs[1] + 6, ytop["code"] + height["code"] + 28, "NEEDS APPROVAL", AMB)
    c.tag(xs[3] + 6, ytop["test"] + height["test"] + 28, "2 TESTS FAILED · RETRY", RUST)
    c.chip(xs[1] + 26, ytop["diff"] + height["diff"] / 2 + 5, S["diff"].tool, "start")
    c.chip(xs[0] + 26, ytop["plan"] + height["plan"] + 22, "done", "start") if False else None
    for k in ("plan", "web"): c.doc(xs[cols[k]] + bw + 6, ytop[k] - 4)
    c.text(xs[7] + 7, ytop["release"] + height["release"] + 24, "FINAL OUTPUT", "middle", SLATE)
    c.text(24, 26, f"EFFORT DELIVERED · {PCT}% OF AGENTS DONE", "start", ACC)
    return c

def board6():
    c = C()
    def room(x, y, w, h, name):
        c.raw.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" stroke="{INK}" stroke-width="2" fill="#F1EFE8"/>')
        c.text(x + 14, y + 22, name, "start", SLATE)
    room(20, 36, 250, 250, f"COMMAND · {PCT}%"); room(300, 36, 484, 250, "RESEARCH LAB"); room(20, 316, 250, 340, "BUILD BAY")
    room(300, 316, 270, 340, "STUDIO"); room(600, 316, 184, 340, "DOCK")
    for x, y, w, h in ((270, 120, 30, 16), (270, 440, 30, 16), (570, 440, 30, 16), (110, 286, 16, 30), (400, 286, 16, 30)):
        c.raw.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{BG}"/>')
    pos = {"orch": (80, 110), "plan": (200, 200), "res": (360, 120), "web": (480, 100), "docs": (590, 100), "diff": (700, 100),
           "code": (90, 410), "lint": (200, 410), "test": (140, 580), "write": (390, 470), "rev": (490, 560), "ship": (690, 450)}
    for aid in TOP:
        if aid != "plan": c.add(line_d(pos["orch"], pos[aid], 16, 14), 1, SLATE, 1.1, op=0.5)
    c.add(line_d(pos["orch"], pos["plan"], 16, 14), 1, SLATE, 1.1, op=0.5)
    for aid, o in S.items():
        if o.parent and o.parent != "orch": c.add(line_d(pos[o.parent], pos[aid], 14, 10), 2, INK, 1.25)
    for a, b in DEPS: c.add(curve_d(pos[a], pos[b], 0.0), 3, SLATE, 1.6, dash="5 4")
    for a, b, _ in messages: c.add(curve_d(pos[a], pos[b], 0.1), 4, ACC, 2.4, dash="0.1 5", cap="round")
    fa, fb, _ = messages[-1]; packet(c, pos[fa], pos[fb], 0.5)
    for aid, p in pos.items():
        c.raw.append(f'<rect x="{f(p[0] - 24)}" y="{f(p[1] + 10)}" width="48" height="18" rx="4" fill="{BG}" stroke="{MIST}" stroke-width="1.5"/>')
    for aid, p in pos.items(): c.node(p[0], p[1], S[aid].state, 10 if aid in TOP + ["orch"] else 7)
    for aid, p in pos.items(): c.text(p[0], p[1] + 44, S[aid].label, "middle", INK)
    for aid, p in pos.items():
        for i, _ in enumerate(S[aid].outputs): c.doc(p[0] + 28 + i * 16, p[1] + 8)
    c.raw.append(f'<rect x="640" y="570" width="104" height="44" rx="6" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3" fill="none"/>')
    c.text(692, 597, "OUTBOX", "middle", SLATE)
    c.chip(pos["orch"][0] + 70, pos["orch"][1] + 4, S["orch"].tool, "start")
    c.chip(pos["diff"][0], pos["diff"][1] + 62, S["diff"].tool)
    c.tag(pos["code"][0] + 40, pos["code"][1] + 66, "NEEDS APPROVAL", AMB)
    c.tag(pos["test"][0] + 50, pos["test"][1] + 66, "2 TESTS FAILED · RETRY", RUST)
    return c

# ===================================================================== legend + notes
def legend():
    c = C(); x = 16; y = 18
    for st, lab in [("working", "WORKING"), ("waiting", "WAITING"), ("blocked", "BLOCKED"), ("failed", "FAILED"), ("done", "DONE")]:
        c.node(x, y, st, 7); c.text(x + 16, y + 4, lab, "start", INK); x += 16 + len(lab) * 7.4 + 34
    x = 4; y2 = 50
    c.add(f"M{x} {y2}h28", 3, INK, 1.25); c.text(x + 38, y2 + 4, "DELEGATES", "start", INK); x += 38 + 9 * 7.4 + 24
    c.add(f"M{x} {y2}h28", 3, SLATE, 1.6, dash="5 4"); c.text(x + 38, y2 + 4, "WAITS FOR", "start", INK); x += 38 + 9 * 7.4 + 24
    c.add(f"M{x} {y2}h28", 3, ACC, 2.4, dash="0.1 5", cap="round"); c.text(x + 38, y2 + 4, "MESSAGE", "start", INK); x += 38 + 7 * 7.4 + 24
    c.doc(x, y2 - 8); c.text(x + 20, y2 + 4, "OUTPUT", "start", INK)
    c.text(4, 80, f"SIMULATED SNAPSHOT · t = {SNAP / 1000:.1f}s OF {META['durationMs'] / 1000:.1f}s · NOT LIVE WORK", "start", SLATE)
    return c.render(804, 90)

BOARDS = [
 ("01", "Orb web", "The task sits at the hub.", "Threads carry the work. Pull one and you can see what moves.", board1,
  ["Task & progress: the hub ring fills as agents finish. 4 of 12 done.", "Agents & subagents: main agents sit on spokes; subagents hang further out on their parent's thread.",
   "Delegation, waiting, messages, tools: spokes delegate, dashed arcs mean waits-for, dotted green threads are messages, chips name the live tool.", "Blocked, failed, outputs: amber tag says what is needed, rust tag shows the failure and the retry, page glyphs are outputs."]),
 ("02", "Hive cells", "Every agent holds a cell.", "A territory view: who owns which cell, and what state it is in.", board2,
  ["Task & progress: the queen cell is the orchestrator; its ring is task progress.", "Agents & subagents: full cells are main agents; small satellite cells are their subagents.",
   "Delegation, waiting, messages, tools: adjacency and solid links delegate, dashed lines wait, dotted green lines message.", "Blocked, failed, outputs: cell fill carries the state; callouts say why; page glyphs sit on the cell that made them."]),
 ("03", "Radar", "Distance from the task.", "Rings are delegation depth. Angle groups related work. Green trails show who moved recently.", board3,
  ["Task & progress: the outer ring fills clockwise with finished agents.", "Agents & subagents: depth 1 agents ring the center; subagents sit on depth 2 behind their parent.",
   "Delegation, waiting, messages, tools: radial lines delegate, dashed chords wait, dotted green chords are messages.", "Blocked, failed, outputs: blips change glyph and callout; page glyphs mark outputs."]),
 ("04", "Routed lattice", "Handoffs run on the grid.", "Right angles only, like a circuit board. Everything that moves has a wire.", board4,
  ["Task & progress: the task starts at the left edge; the right edge is the final release.", "Agents & subagents: chips on the grid; subagents branch off their parent's wire.",
   "Delegation, waiting, messages, tools: grey rails delegate, dashed wires wait, green wires with a packet are messages.", "Blocked, failed, outputs: a blocked or failed chip has a labelled callout; page glyphs sit on the chip's output side."]),
 ("05", "Contribution river", "How everything feeds the result.", "Width is effort. Follow the river from the plan to the final release.", board5,
  ["Task & progress: the river runs left to right; the empty channel on the right is the unfinished result.", "Agents & subagents: bars are agents; subagents join the river as side streams.",
   "Delegation, waiting, messages, tools: ribbons are contributions; dashed ribbons are work not yet flowing.", "Blocked, failed, outputs: an amber bar is a dam, a rust bar is an eddy; page glyphs are outputs dropped along the way."]),
 ("06", "Floorplan", "An office, with the plumbing showing.", "Rooms are workstreams. Desks hold agents. Documents pile up on the desks that made them.", board6,
  ["Task & progress: the clock in Command shows task progress.", "Agents & subagents: desks in a room; subagents share their parent's room.",
   "Delegation, waiting, messages, tools: dashed lines show who waits for whom, dotted green lines are messages, chips name the live tool.", "Blocked, failed, outputs: callouts say what is needed or what failed; the dashed outbox is the unfinished result."]),
 ("07", "Swimlanes", "Time, one lane per agent.", "A timeline of the whole run. The dashed line is now; everything to its right is still planned.", board7,
  ["Task & progress: the NOW line against the full run length, plus the percent done.", "Agents & subagents: one lane each, subagents sit directly under their parent.",
   "Delegation, waiting, messages, tools: curves are handoffs, dotted green curves are messages, dotted lane segments are waiting.", "Blocked, failed, outputs: amber hatched bars are blocked, rust bars failed, page glyphs mark each output when it appeared."]),
 ("08", "Territories", "Every agent owns a patch.", "A map. States color the land. Lines show how the territories depend on each other.", board8,
  ["Task & progress: the share of the map already claimed.", "Agents & subagents: a main agent owns a region; its subagents live inside it.",
   "Delegation, waiting, messages, tools: dashed lines are waits-for, dotted green lines are messages, chips name the live tool.", "Blocked, failed, outputs: region tint and callouts; page glyphs sit on the seed that produced them."]),
 ("09", "Card tree", "Delegation, as an org chart.", "Cards say what each agent is doing in words, so you can read the run like a status report.", board9,
  ["Task & progress: the orchestrator card at the left root, with percent done.", "Agents & subagents: columns are depth; subagent cards sit to the right of their parent.",
   "Delegation, waiting, messages, tools: elbows delegate, dashed arcs on the right are waits-for, dotted green arcs are messages.", "Blocked, failed, outputs: each card states why in words; page glyphs sit on the card's corner."]),
 ("10", "Message matrix", "Who is talking to whom.", "A table of every relationship: rows send, columns receive. The diagonal shows each agent's own state.", board10,
  ["Task & progress: the line above the matrix summarizes progress and message count.", "Agents & subagents: rows and columns are the same twelve agents.",
   "Delegation, waiting, messages, tools: solid outline is delegation, dashed outline is waits-for, a green cell is a message.", "Blocked, failed, outputs: the diagonal carries each agent's state glyph; page glyphs in the right column are outputs."]),
]

if __name__ == "__main__":
    out = os.path.join(HERE, "boards"); os.makedirs(out, exist_ok=True)
    for num, name, title, cap, fn, notes in BOARDS:
        svg = fn().render()
        import re as _re
        svg = svg.replace(' stroke="#EAE8E1" stroke-width="3" paint-order="stroke"', '')
        svg = _re.sub(r'(\d+\.\d)0+\b', r'\1', svg)
        open(os.path.join(out, f"b{num}.svg"), "w").write(svg)
        print(num, name, len(svg))
    open(os.path.join(out, "legend.svg"), "w").write(legend())
    json.dump([{"num": b[0], "name": b[1], "title": b[2], "caption": b[3], "notes": b[5]} for b in BOARDS], open(os.path.join(out, "meta.json"), "w"), indent=1)
    print("states at snapshot:", dict(counts), "pct", PCT)
