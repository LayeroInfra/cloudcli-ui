#!/usr/bin/env python3
"""Correct the 8080 target of the old, workspace-owned macOS tunnel."""
from __future__ import annotations

import os
import plistlib
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

LABEL = "ru.layero.cloudcli-tunnel"
OLD = "127.0.0.1:8080:127.0.0.1:5174"
NEW = "127.0.0.1:8080:127.0.0.1:8080"


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check, timeout=10)


def addresses(host: str) -> set[str]:
    return {row[4][0] for row in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}


def workspace_matches(args: list[str], users: Path) -> bool:
    if not users.is_file() or not args or args[-1] != "layero-dev" or "-F" not in args:
        return False
    config = args[args.index("-F") + 1]
    result = run("/usr/bin/ssh", "-G", "-F", config, "layero-dev", check=False)
    target = next((line.split()[1] for line in result.stdout.splitlines()
                   if line.startswith("hostname ")), None)
    if result.returncode or not target:
        return False
    hosts = [line.split()[0] for line in users.read_text().splitlines()
             if len(line.split()) == 2 and line.split()[0].endswith(".workspace.layero.app")]
    target_ips = addresses(target)
    return any(target_ips & addresses(host) for host in hosts)


def atomic_write(path: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        staged = Path(temp.name)
        temp.write(data)
    try:
        staged.chmod(path.stat().st_mode & 0o777)
        run("/usr/bin/plutil", "-lint", str(staged))
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def pid_of(service: str) -> str | None:
    result = run("/bin/launchctl", "print", service, check=False)
    match = re.search(r"^\s*pid = (\d+)", result.stdout, re.MULTILINE)
    return match.group(1) if match else None


def listening(pid: str, ports: set[int]) -> bool:
    result = run("/usr/sbin/lsof", "-nP", "-a", "-p", pid, "-iTCP", "-sTCP:LISTEN", "-Fn", check=False)
    bound = {int(m.group(1)) for m in re.finditer(r"^n127\.0\.0\.1:(\d+)$", result.stdout, re.MULTILINE)}
    return ports <= bound


def migrate(users: Path) -> None:
    home = Path.home()
    plist = home / "Library/LaunchAgents" / f"{LABEL}.plist"
    if not plist.is_file() or plist.is_symlink():
        return
    original = plist.read_bytes()
    job = plistlib.loads(original)
    args = job.get("ProgramArguments", [])
    forwards = [i + 1 for i, arg in enumerate(args[:-1]) if arg == "-L"]
    matches = [i for i in forwards if args[i] == OLD]
    if (job.get("Label") != LABEL or len(matches) != 1 or
            Path(args[0]).name != "ssh" or not workspace_matches(args, users)):
        return

    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    previous_pid = pid_of(service)
    if previous_pid and not listening(previous_pid, {8080}):
        raise RuntimeError("the legacy agent is not the owner of local port 8080")

    ports = {int(m.group(1)) for i in forwards
             if (m := re.match(r"127\.0\.0\.1:(\d+):", args[i]))}
    args[matches[0]] = NEW
    state = home / ".local/state/cloudcli-companion"
    with tempfile.NamedTemporaryFile(dir=state, prefix=f"{LABEL}.before-8080.", suffix=".plist", delete=False) as backup:
        backup.write(original)
    atomic_write(plist, plistlib.dumps(job, sort_keys=False))
    if previous_pid:
        stopped = False
        try:
            run("/bin/launchctl", "bootout", service)
            stopped = True
            run("/bin/launchctl", "bootstrap", domain, str(plist))
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                pid = pid_of(service)
                if pid and pid != previous_pid and listening(pid, ports):
                    break
                time.sleep(0.2)
            else:
                raise RuntimeError("the reloaded agent did not reopen all IPv4 forwards")
        except Exception:
            if stopped:
                run("/bin/launchctl", "bootout", service, check=False)
            atomic_write(plist, original)
            if stopped:
                run("/bin/launchctl", "bootstrap", domain, str(plist))
            raise
    print("Layero Workspace: legacy localhost:8080 now forwards to port 8080 on the VM")


if __name__ == "__main__":
    try:
        migrate(Path(sys.argv[1]))
    except (OSError, RuntimeError, ValueError, IndexError, subprocess.SubprocessError) as error:
        print(f"Layero Workspace: could not migrate the legacy preview tunnel ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
