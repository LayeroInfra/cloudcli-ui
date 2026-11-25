#!/usr/bin/env python3
"""Branded Layero sign-in window for the Mac companion.

Serves app/signin/index.html on a loopback port, opens it in Chrome/Safari
app mode, validates the form, and returns the values over stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WORKSPACE_DOMAIN = "workspace.layero.app"
SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
OWNER_RE = re.compile(r"^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$")


def normalize_workspace(raw: str) -> str | None:
    value = raw.strip().lower()
    value = re.sub(r"^https?://", "", value)
    value = value.rstrip("/").rstrip(".")
    if not value:
        return None
    if "." in value:
        suffix = "." + WORKSPACE_DOMAIN
        if (
            len(value) <= 253
            and value.endswith(suffix)
            and all(SLUG_RE.fullmatch(label) for label in value[:-len(suffix)].split("."))
        ):
            return value
        return None
    if len(value) >= 2 and SLUG_RE.fullmatch(value):
        return f"{value}.{WORKSPACE_DOMAIN}"
    return None


def normalize_owner(raw: str) -> str | None:
    value = raw.strip().lower()
    value = re.sub(r"[^a-z0-9_-]+", "-", value)
    value = value.strip("-")
    value = re.sub(r"-+", "-", value)
    if len(value) < 3 or not OWNER_RE.match(value):
        return None
    return value


def open_app_window(url: str) -> None:
    # Chrome app mode ≈ dedicated branded window without browser chrome.
    chrome = Path("/Applications/Google Chrome.app")
    if chrome.exists():
        subprocess.Popen(
            [
                "open",
                "-na",
                "Google Chrome",
                "--args",
                f"--app={url}",
                "--new-window",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    subprocess.Popen(
        ["open", url],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True)
    parser.add_argument("--workspace", default="")
    parser.add_argument("--username", default="")
    parser.add_argument("--error", default="")
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()

    html_path = Path(args.html)
    if not html_path.is_file():
        print(f"missing html: {html_path}", file=sys.stderr)
        return 2

    html_bytes = html_path.read_bytes()
    static_dir = html_path.parent
    static_types = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
    }
    result: dict | None = None
    done = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a) -> None:
            return

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path in ("/", "/index.html"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(html_bytes)))
                self.end_headers()
                self.wfile.write(html_bytes)
                return
            name = Path(parsed.path).name
            if name and ".." not in name:
                asset = static_dir / name
                if asset.is_file() and asset.suffix in static_types:
                    data = asset.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", static_types[asset.suffix])
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
            self.send_error(404)

        def do_POST(self) -> None:
            nonlocal result
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != "/submit":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._json(400, {"error": "Некорректный запрос"})
                return

            if not isinstance(payload, dict):
                self._json(400, {"error": "Некорректный запрос"})
                return
            host = normalize_workspace(str(payload.get("workspace") or ""))
            owner = normalize_owner(str(payload.get("username") or ""))
            password = str(payload.get("password") or "")
            if not host:
                self._json(
                    400,
                    {
                        "error": f"Нужен slug или адрес *.{WORKSPACE_DOMAIN}",
                    },
                )
                return
            if not owner:
                self._json(
                    400,
                    {"error": "Имя: a-z 0-9 _ -, от 3 символов, без дефиса по краям"},
                )
                return
            if not password or "\0" in password:
                self._json(400, {"error": "Введите пароль Layero Workspace"})
                return

            result = {
                "workspaceHost": host,
                "owner": owner,
                "password": password,
            }
            self._json(200, {"ok": True})
            done.set()

        def _json(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            query = urllib.parse.urlencode(
                {"workspace": args.workspace, "username": args.username, "error": args.error}
            )
            if args.native:
                query += "&native=1"
            url = f"http://127.0.0.1:{server.server_port}/?{query}"
            if args.native:
                os.write(3, (json.dumps({"signInURL": url}) + "\n").encode())
            else:
                open_app_window(url)

            if not done.wait(timeout=args.timeout):
                print("signin timeout", file=sys.stderr)
                return 1
        finally:
            server.shutdown()

    if not result:
        return 1

    for key in ("workspaceHost", "owner", "password"):
        sys.stdout.buffer.write(result[key].encode() + b"\0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
