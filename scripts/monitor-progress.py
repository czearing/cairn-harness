"""Live progress monitor for a Harness project.

Prints unambiguous, ground-truth signals of forward progress instead of
relying on a single task row's claimed_at (which churns during normal
in-progress work and is not itself evidence of a stall).

Usage: python monitor-progress.py <project-root> [<specs-dir>]
"""
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def newest_file(directory: Path, pattern: str = "*.md"):
    files = sorted(directory.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def last_commit(root: Path):
    result = subprocess.run(
        ["git", "-C", str(root), "log", "-1", "--format=%h %cI %s"],
        capture_output=True, text=True, check=False,
    )
    return result.stdout.strip() or None


def recent_tasks(db_path: Path, limit: int = 5):
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute(
        "SELECT id, assignee, topic, status, claimed_at, completed_at "
        "FROM tasks ORDER BY created_at DESC LIMIT ?",
        (limit,),
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    specs_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    now = datetime.now(timezone.utc)

    print(f"now (utc): {now.isoformat()}")

    db_path = root / ".cairn-harness" / "harness.db"
    if db_path.exists():
        print("\n-- recent tasks --")
        for row in recent_tasks(db_path):
            print(row)
    else:
        print(f"\nNo harness.db found at {db_path}")

    commit = last_commit(root)
    print(f"\n-- last commit --\n{commit or 'no commits found'}")

    if specs_dir and specs_dir.exists():
        newest = newest_file(specs_dir)
        if newest:
            age_min = (now.timestamp() - newest.stat().st_mtime) / 60
            print(f"\n-- newest spec file --\n{newest.name} ({age_min:.1f} min ago)")
        else:
            print(f"\nNo spec files found in {specs_dir}")


if __name__ == "__main__":
    main()
