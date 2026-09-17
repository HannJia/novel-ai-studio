"""Run locally on the server. Never expose this tool over HTTP."""
import argparse
import gzip
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .app import Repository


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=os.environ.get("SYNC_DATA_DIR", "/var/lib/novel-sync"))
    sub = parser.add_subparsers(dest="command", required=True)
    invite = sub.add_parser("invite")
    invite.add_argument("--admin", action="store_true")
    invite.add_argument("--uses", type=int, default=1)
    backup = sub.add_parser("backup")
    backup.add_argument("--directory", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    repo = Repository(args.data_dir)
    if args.command == "invite":
        if not 1 <= args.uses <= 20:
            parser.error("uses must be between 1 and 20")
        print(repo.invite("admin" if args.admin else "user", uses=args.uses))
    elif args.command == "backup":
        directory = Path(args.directory)
        directory.mkdir(parents=True, exist_ok=True)
        name = "sync-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".sqlite3.gz"
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            snapshot = Path(temporary) / "snapshot.sqlite3"
            with sqlite3.connect(repo.path) as source, sqlite3.connect(snapshot) as target:
                source.backup(target)
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup integrity check failed")
            pending = directory / (name + ".tmp")
            with snapshot.open("rb") as source, gzip.open(pending, "wb") as target:
                shutil.copyfileobj(source, target)
            pending.replace(directory / name)
        for old in sorted(directory.glob("sync-*.sqlite3.gz"))[:-3]:
            old.unlink()
        print(str(directory / name))


if __name__ == "__main__":
    main()
