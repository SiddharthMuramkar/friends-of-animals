#!/usr/bin/env python3
"""Launch foa-factory panes in the orchestrator's Herdr tab. Run with python3 -I.

  launch.py board
  launch.py merge
  launch.py prep <issue> [<issue> ...]
  launch.py build <unit> [<unit> ...]
"""
import json, os, subprocess, sys

F = "/root/foa-work/factory"
P = f"{F}/prompts"
REPO = "/root/friends-of-animals"
UNITS = json.load(open(f"{F}/units.json"))["units"]
BY = {u["id"]: u for u in UNITS}
ME = os.environ.get("HC_TERMINAL_ID", "t18")


def labels():
    g = json.loads(subprocess.run(["hc", "get", ME], capture_output=True, text=True, check=True).stdout)["labels"]
    return [x for k in ("herdr.space", "herdr.tab") if k in g for x in ("--label", f"{k}={g[k]}")]


def run(name, cwd, argv):
    cmd = ["hc", "run", "--bg", "--outlive-parent", "--name", name, "--cwd", cwd, *labels(), *argv]
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout or r.stderr).strip().splitlines()
    print(name, "->", r.returncode, out[-1][:160] if out else "")


def claude(name, title, cwd, msg):
    run(name, cwd, ["claude", "--permission-mode", "auto", "-n", title, msg])


def unit_card(u):
    sib = [{"id": s["id"], "title": s["title"]} for s in UNITS if s["issue"] == u["issue"] and s["id"] != u["id"]]
    return {"unit": u["id"], "issue": u["issue"], "title": u["title"], "milestone": u["milestone"], "branch": u["branch"],
            "worktree": f"/root/foa-wt/{u['id']}", "blockers": u["blockers"], "keys": u["keys"], "risk": u["risk"],
            "size": u["size"], "siblings": sib}


def main(a):
    c = a[0]
    if c == "board":
        run("foa-board", F, ["bash", "-c", f"while :; do clear; python3 -I {F}/factory.py board; sleep 20; done"])
    elif c == "merge":
        msg = (f"You are pane foa-merge. Read {P}/pane-merge.md and {P}/rules.md in full and follow them. Set up now: create the "
               "detached worktrees /root/foa-wt/_merge and /root/foa-wt/_cascade from foa/M0 and run pnpm install --frozen-lockfile "
               "--offline in each. Then run: hc send t18 \"MERGE-PANE READY\" and wait for jobs.")
        claude("foa-merge", "foa merge queue", REPO, msg)
    elif c == "prep":
        for n in a[1:]:
            us = [u for u in UNITS if u["issue"] == int(n) and not u["done"]]
            inp = {"issue": int(n), "title": us[0]["issueTitle"], "milestone": us[0]["milestone"],
                   "units": [unit_card(u) for u in us]}
            msg = (f"You are pane foa-p{n}. Read {P}/pane-prep.md and {P}/rules.md in full and follow them for this input:\n"
                   + json.dumps(inp, indent=1))
            claude(f"foa-p{n}", f"prep #{n}", REPO, msg)
    elif c == "build":
        for uid in a[1:]:
            u = BY[uid]
            wt = f"/root/foa-wt/{uid}"
            g = lambda *x: subprocess.run(["git", "-C", REPO, *x], capture_output=True, text=True)
            if not os.path.isdir(wt):
                g("fetch", "-q", "foa")
                if g("rev-parse", "--verify", "-q", f"refs/heads/{u['branch']}").returncode == 0:
                    r = g("worktree", "add", wt, u["branch"])
                elif g("rev-parse", "--verify", "-q", f"refs/remotes/foa/{u['branch']}").returncode == 0:
                    r = g("worktree", "add", "-b", u["branch"], wt, f"foa/{u['branch']}")
                else:
                    r = g("worktree", "add", "-b", u["branch"], wt, f"foa/{u['milestone']}")
                if r.returncode:
                    print(uid, "worktree failed:", r.stderr.strip()[:200])
                    continue
            msg = (f"You are pane foa-{uid}. Read {P}/pane-build.md and {P}/rules.md in full and follow them for this input:\n"
                   + json.dumps(unit_card(u), indent=1))
            claude(f"foa-{uid}", f"build {uid}", wt, msg)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
