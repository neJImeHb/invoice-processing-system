#!/usr/bin/env python3
"""Merge .gitignore.sdlc patterns into .gitignore or .git/info/exclude."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER_START = "# >>> ai-sdlc-overlay >>>"
MARKER_END = "# <<< ai-sdlc-overlay <<<"
VALID_MODES = frozenset({"local-only", "team"})
ANSWERS_FILE = Path(".copier-answers.sdlc.yml")
PATTERNS_FILE = Path(".gitignore.sdlc")


def load_tracking_mode() -> str:
    if ANSWERS_FILE.is_file():
        for line in ANSWERS_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("tracking_mode:"):
                raw = line.split(":", 1)[1].strip()
                if "#" in raw:
                    raw = raw.split("#", 1)[0].strip()
                mode = raw.strip('"').strip("'")
                if mode in VALID_MODES:
                    return mode
    if len(sys.argv) > 1 and sys.argv[1] in VALID_MODES:
        return sys.argv[1]
    raise SystemExit(
        f"Could not determine tracking_mode from {ANSWERS_FILE}. "
        "Pass local-only or team explicitly."
    )


def load_patterns(source: Path) -> list[str]:
    if not source.is_file():
        raise SystemExit(f"Missing {source}")
    patterns: list[str] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        patterns.append(line.rstrip())
    return patterns


def validate_patterns(mode: str, patterns: list[str]) -> None:
    has_overlay_root = ".sdlc/" in patterns
    if mode == "local-only" and not has_overlay_root:
        raise SystemExit(
            f"{PATTERNS_FILE} has team-mode patterns but tracking_mode is local-only. "
            "Run: copier recopy --trust -a .copier-answers.sdlc.yml"
        )
    if mode == "team" and has_overlay_root:
        raise SystemExit(
            f"{PATTERNS_FILE} has local-only patterns but tracking_mode is team. "
            "Run: copier recopy --trust -a .copier-answers.sdlc.yml"
        )


def strip_block(content: str) -> str:
    start = content.find(MARKER_START)
    while start != -1:
        end = content.find(MARKER_END, start)
        if end == -1:
            break
        line_end = content.find("\n", end)
        if line_end == -1:
            content = content[:start].rstrip()
            if content:
                content += "\n"
            break
        content = content[:start] + content[line_end + 1 :]
        start = content.find(MARKER_START)
    return content.rstrip() + ("\n" if content.strip() else "")


def apply_block(content: str, patterns: list[str]) -> str:
    block = "\n".join([MARKER_START, *patterns, MARKER_END, ""])
    content = strip_block(content)
    if content.strip():
        return content.rstrip() + "\n\n" + block
    return block


def target_for_mode(mode: str) -> Path:
    if mode == "local-only":
        return Path(".git/info/exclude")
    return Path(".gitignore")


def clear_marker(path: Path) -> bool:
    if not path.is_file():
        return False
    original = path.read_text(encoding="utf-8")
    updated = strip_block(original)
    if updated == original:
        return False
    if updated.strip():
        path.write_text(updated, encoding="utf-8", newline="\n")
    else:
        path.unlink(missing_ok=True)
    return True


def remove_all_markers() -> None:
    changed = clear_marker(Path(".gitignore")) or clear_marker(Path(".git/info/exclude"))
    if changed:
        print("Removed ai-sdlc-overlay marker block(s)")
    else:
        print("No ai-sdlc-overlay marker blocks found")


def main() -> None:
    if "--remove" in sys.argv:
        remove_all_markers()
        return

    mode = load_tracking_mode()
    if len(sys.argv) > 1 and sys.argv[1] in VALID_MODES and sys.argv[1] != mode:
        raise SystemExit(
            f"tracking_mode mismatch: CLI={sys.argv[1]!r} but {ANSWERS_FILE}={mode!r}. "
            "Run copier recopy --trust -a .copier-answers.sdlc.yml after changing mode."
        )

    patterns = load_patterns(PATTERNS_FILE)
    validate_patterns(mode, patterns)

    target = target_for_mode(mode)
    if mode == "local-only":
        if not Path(".git").is_dir():
            raise SystemExit(
                "No .git directory found. Run `git init` (or clone the repo) first, "
                "then re-run: make -f Makefile.sdlc sdlc-apply-ignore"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        if clear_marker(Path(".gitignore")):
            print("Removed stale ai-sdlc-overlay block from .gitignore")

    if mode == "team" and clear_marker(Path(".git/info/exclude")):
        print("Removed stale ai-sdlc-overlay block from .git/info/exclude")

    existing = target.read_text(encoding="utf-8") if target.is_file() else ""
    target.write_text(apply_block(existing, patterns), encoding="utf-8", newline="\n")
    print(f"Applied {len(patterns)} pattern(s) to {target} ({mode} mode)")


if __name__ == "__main__":
    main()
