import json, re, sys
from collections import defaultdict
base = sys.argv[1]
dag = open(f"{base}/dag.md").read()
titles = {i["number"]: i["title"] for i in json.load(open(f"{base}/issues.json"))}
live = {}
for line in open(f"{base}/live-edges.tsv"):
    n, b = line.rstrip("\n").split("\t")
    live[int(n)] = [int(x) for x in b.split(",") if x]

ADOPT = {"57a": "harness", "57b": "email-otp", "57c": "sessions"}
def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return "-".join(s.split("-")[:5])

units, order = {}, []
for row in re.findall(r"^\| (M\d) \| #(\d+) [^|]*\|[^|]*\| (.*) \|$", dag, re.M):
    ms, issue, cell = row[0], int(row[1]), row[2]
    if "done on" in cell:
        units[f"{issue}"] = dict(id=f"{issue}", issue=issue, milestone=ms, done=True, blockers=[], label="", size="M", judges=1)
        order.append(f"{issue}"); continue
    for part in [p.strip() for p in cell.split(" ; ")]:
        m = re.match(r"^(\d+[a-z]?)\s+(?:(.+?)\s+)?([ML])·(N|P|B2|B3)·(\d)\s+←\s+(.*)$", part)
        if not m: raise SystemExit(f"unparsed: {part!r}")
        uid, label, size, tourn, judges, bl = m.groups()
        bl = [] if bl.strip() in ("—", "-") else [b.strip() for b in bl.split(",")]
        units[uid] = dict(id=uid, issue=issue, milestone=ms, done=False, blockers=bl, label=label or "", size=size, judges=int(judges), tourn=tourn)
        order.append(uid)

by_issue = defaultdict(list)
for uid in order: by_issue[units[uid]["issue"]].append(uid)
for uid in order:
    for b in units[uid]["blockers"]:
        if b not in units: raise SystemExit(f"{uid}: unknown blocker {b}")

# serialization pairs from dag.md 1.1, kept as plain edges
for a, b in [("72", "71"), ("79", "78"), ("108", "107"), ("91a", "92")]:
    if b not in units[a]["blockers"]: units[a]["blockers"].append(b)

def ancestors(uid, memo={}):
    if uid in memo: return memo[uid]
    s = set()
    for b in units[uid]["blockers"]:
        s.add(b); s |= ancestors(b)
    memo[uid] = s; return s

added = []
for issue, blks in live.items():
    first = by_issue[issue][0]
    for a in blks:
        a_units = set(by_issue[a])
        covered = any(ancestors(u, {}) & a_units for u in by_issue[issue])
        if not covered:
            last = by_issue[a][-1]
            units[first]["blockers"].append(last); added.append(f"{first} <- {last} (live #{issue} <- #{a})")

# conflict keys
keys = defaultdict(list)
sec = dag.split("### 3.1")[1].split("### 3.2")[0]
for kid, ulist in re.findall(r"^\| (X\d+) [^|]*\|[^|]*\| ([^|]+) \|$", sec, re.M):
    for u in ulist.split():
        keys[u].append(kid)

# cycle check + priority (longest downstream path, in units)
children = defaultdict(list)
for uid in order:
    for b in units[uid]["blockers"]: children[b].append(uid)
state = {}
def visit(u, stack=()):
    if state.get(u) == 1: raise SystemExit(f"cycle: {stack + (u,)}")
    if state.get(u) == 2: return
    state[u] = 1
    for c in children[u]: visit(c, stack + (u,))
    state[u] = 2
for u in order: visit(u)
prio = {}
def lp(u):
    if u not in prio: prio[u] = 1 + max([lp(c) for c in children[u]] or [0])
    return prio[u]

out = []
for uid in order:
    u = units[uid]
    t = re.sub(r"^M\d+: ", "", titles[u["issue"]])
    multi = len(by_issue[u["issue"]]) > 1
    slug = ADOPT.get(uid) or (slugify(u["label"]) if multi and u["label"] else slugify(t))
    out.append(dict(
        id=uid, issue=u["issue"], milestone=u["milestone"], done=u["done"],
        title=t + (f" ({u['label']})" if multi and u["label"] else ""),
        issueTitle=t, slug=slug, branch=f"ticket/{u['issue']}-{slug}",
        blockers=sorted(set(u["blockers"]), key=order.index), keys=keys.get(uid, []),
        risk=u["judges"] == 3, size=u["size"], priority=lp(uid),
        lastOfIssue=by_issue[u["issue"]][-1] == uid, adopt=uid in ADOPT))
branches = [o["branch"] for o in out]
assert len(branches) == len(set(branches)), "duplicate branch"
json.dump(dict(units=out, addedLiveEdges=added), open(f"{base}/units.json", "w"), indent=1)
print(len(out), "units;", sum(1 for o in out if not o["done"]), "to build;", len(added), "live edges added")
print("\n".join(added))
