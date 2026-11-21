#!/usr/bin/env python3
"""foa-factory state and scheduler. Run with python3 -I.

  factory.py init                      create state.json from units.json (keeps existing state)
  factory.py set <unit|#issue> <state> [key=value ...]
  factory.py ready                     units whose blockers are merged and whose conflict keys are free
  factory.py prep-queue                issues not yet prepped, by priority
  factory.py board                     live board (for the foa-board pane)
  factory.py show <unit>
States: todo prepping prepped building review fixing merging merged failed external
"""
import json, os, sys, time, fcntl
from collections import defaultdict

D = os.path.dirname(os.path.abspath(__file__))
UNITS = json.load(open(os.path.join(D, "units.json")))["units"]
BY = {u["id"]: u for u in UNITS}
ORDER = [u["id"] for u in UNITS]
SP = os.path.join(D, "state.json")
ACTIVE = {"building", "review", "fixing", "merging"}


def load():
    if not os.path.exists(SP):
        return {"units": {}}
    return json.load(open(SP))


def save(s):
    tmp = SP + ".tmp"
    json.dump(s, open(tmp, "w"), indent=1)
    os.replace(tmp, SP)


def locked(fn):
    def w(*a):
        with open(SP + ".lock", "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            return fn(*a)
    return w


@locked
def init():
    s = load()
    for u in UNITS:
        s["units"].setdefault(u["id"], {"state": "merged" if u["done"] else "todo"})
    save(s)
    print(f"{len(s['units'])} units in state.json")


@locked
def set_(target, state, *kv):
    s = load()
    ids = [u["id"] for u in UNITS if f"#{u['issue']}" == target] if target.startswith("#") else [target]
    for i in ids:
        if i not in BY:
            sys.exit(f"unknown unit {i}")
        st = s["units"].setdefault(i, {})
        st["state"] = state
        st["t"] = int(time.time())
        for p in kv:
            k, v = p.split("=", 1)
            st[k] = v
    save(s)
    print("set", ",".join(ids), "->", state)


def ready(s=None):
    s = s or load()
    st = lambda i: s["units"].get(i, {}).get("state", "todo")
    held = {k for i in ORDER if st(i) in ACTIVE for k in BY[i]["keys"]}
    out, taken = [], set()
    for u in sorted(UNITS, key=lambda u: -u["priority"]):
        if st(u["id"]) not in ("todo", "prepped", "prepping"):
            continue
        if not all(st(b) == "merged" for b in u["blockers"]):
            continue
        if set(u["keys"]) & (held | taken):
            continue
        taken |= set(u["keys"])
        out.append(u["id"])
    return out


def prep_queue(s=None):
    s = s or load()
    st = lambda i: s["units"].get(i, {}).get("state", "todo")
    issues = defaultdict(list)
    for u in UNITS:
        issues[u["issue"]].append(u)
    q = [(max(u["priority"] for u in us), n) for n, us in issues.items() if all(st(u["id"]) == "todo" for u in us)]
    return [n for _, n in sorted(q, reverse=True)]


GLYPH = {"todo": ".", "prepping": "p", "prepped": "P", "building": "B", "review": "R", "fixing": "F",
         "merging": "M", "merged": "#", "failed": "X", "external": "E"}


def board():
    s = load()
    st = lambda i: s["units"].get(i, {}).get("state", "todo")
    cnt = defaultdict(int)
    for i in ORDER:
        cnt[st(i)] += 1
    print(time.strftime("%H:%M:%S"), " foa-factory  ", "  ".join(f"{k}:{v}" for k, v in sorted(cnt.items())))
    print("legend: . todo  p prepping  P prepped  B building  R review  F fixing  M merging  # merged  X failed  E external\n")
    byms = defaultdict(list)
    for i in ORDER:
        byms[BY[i]["milestone"]].append(i)
    for ms in sorted(byms):
        cells = [f"{i}{GLYPH.get(st(i), '?')}" for i in byms[ms]]
        line, out = "", []
        for c in cells:
            if len(line) + len(c) + 1 > 100:
                out.append(line)
                line = ""
            line += c.ljust(6)
        out.append(line)
        done = sum(1 for i in byms[ms] if st(i) == "merged")
        print(f"{ms} {done}/{len(byms[ms])}  " + ("\n" + " " * 9).join(out))
    print("\nIn flight:")
    for i in ORDER:
        u = s["units"].get(i, {})
        if u.get("state") in ACTIVE | {"prepping", "failed", "external"}:
            extra = " ".join(f"{k}={v}" for k, v in u.items() if k not in ("state", "t"))
            age = int((time.time() - u.get("t", time.time())) / 60)
            print(f"  {i:<5} {u['state']:<9} {age:>4}m  {BY[i]['title'][:58]:<58} {extra}")
    print("\nReady to build now:", " ".join(ready(s)) or "-")


def main(a):
    if not a:
        print(__doc__)
        return
    c = a[0]
    if c == "init":
        init()
    elif c == "set":
        set_(*a[1:])
    elif c == "ready":
        print(" ".join(ready()))
    elif c == "prep-queue":
        print(" ".join(map(str, prep_queue())))
    elif c == "board":
        board()
    elif c == "show":
        print(json.dumps({**BY[a[1]], "state": load()["units"].get(a[1])}, indent=1))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
