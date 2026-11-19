"""Removes Vercel's bypass cookie from the Playwright artefacts before upload.

Traces record request headers, so a failed run's trace holds the cookie
global setup got with the bypass secret (tests/e2e/global-setup.ts). It
opens that preview for a week, and artefacts on this public repo can be
downloaded by anyone signed in to GitHub. Run from the repo root.
"""

import json
import pathlib
import zipfile

STATE = pathlib.Path("playwright/.auth/vercel-bypass.json")
ARTEFACTS = ("test-results", "playwright-report")
REDACTED = b"[redacted]"


def main() -> None:
    if not STATE.exists():
        return
    cookies = json.loads(STATE.read_text())["cookies"]
    values = [c["value"].encode() for c in cookies if len(c["value"]) >= 16]
    if not values:
        return

    def scrub(data: bytes) -> bytes:
        for value in values:
            data = data.replace(value, REDACTED)
        return data

    for root in ARTEFACTS:
        for path in pathlib.Path(root).rglob("*"):
            if not path.is_file():
                continue
            if zipfile.is_zipfile(path):
                with zipfile.ZipFile(path) as archive:
                    entries = [(i, scrub(archive.read(i))) for i in archive.infolist()]
                with zipfile.ZipFile(path, "w") as archive:
                    for info, data in entries:
                        archive.writestr(info, data)
            else:
                path.write_bytes(scrub(path.read_bytes()))


if __name__ == "__main__":
    main()
