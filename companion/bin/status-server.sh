#!/bin/bash
# Local status UI: what is building on THIS Mac right now.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/identity.sh
source "$ROOT_DIR/bin/lib/identity.sh"
LOG_DIR="${HOME}/.local/state/cloudcli-companion"
PID_FILE="$LOG_DIR/status-server.pid"
PORT="${WORKSPACE_STATUS_PORT:-19100}"
mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "status-server already on :$PORT pid=$(cat "$PID_FILE")"
  exit 0
fi

require_identity
OWNER="$(identity_owner)"
GATEWAY="$(identity_get gatewayUrl)"
CHECKOUT="$(identity_get checkout)"

export OWNER GATEWAY CHECKOUT PORT LOG_DIR
python3 - <<'PY' >>"$LOG_DIR/status-server.log" 2>&1 &
import json, os, re, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

OWNER = os.environ["OWNER"]
GATEWAY = os.environ["GATEWAY"]
CHECKOUT = os.environ["CHECKOUT"]
PORT = int(os.environ["PORT"])
LOG_DIR = Path(os.environ["LOG_DIR"])
AGENT_LOG = LOG_DIR / "agent.log"
TUNNEL_PID = LOG_DIR / "tunnel.pid"

def sh(cmd):
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""

def running_builds():
    out = sh(["/bin/ps", "-ax", "-o", "pid=,etime=,command="])
    rows = []
    for line in out.splitlines():
        if "workspace-run-checks" in line or "woodpecker-local-" in line or (
            "tsx --tsconfig" in line and "claude-sessions.test" in line
        ) or ("vitest run" in line and "sidebarAccount" in line):
            parts = line.strip().split(None, 2)
            if len(parts) >= 3:
                rows.append({"pid": parts[0], "etime": parts[1], "command": parts[2][:220]})
    return rows

def agent_alive():
    return bool(sh(["/usr/bin/pgrep", "-f", "woodpecker-agent"]))

def tunnel_alive():
    if not TUNNEL_PID.exists():
        return False
    try:
        pid = int(TUNNEL_PID.read_text().strip())
    except Exception:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def recent_agent_events(limit=12):
    if not AGENT_LOG.exists():
        return []
    lines = AGENT_LOG.read_text(errors="replace").splitlines()[-200:]
    events = []
    for line in lines:
        if '"pipeline"' in line or "starting Woodpecker" in line or "workflow finished" in line or "grpc error" in line:
            events.append(line[-300:])
    return events[-limit:]

def status_payload():
    return {
        "owner": OWNER,
        "gatewayUrl": GATEWAY,
        "checkout": CHECKOUT,
        "agentAlive": agent_alive(),
        "tunnelAlive": tunnel_alive(),
        "running": running_builds(),
        "recent": recent_agent_events(),
        "ts": int(time.time()),
    }

HTML = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Layero Workspace — сборки</title>
<style>
:root { color-scheme: light dark; --bg:#0f1115; --card:#1a1d24; --fg:#e8eaed; --muted:#9aa0a6; --ok:#3dd68c; --bad:#f87171; --acc:#7dd3fc; }
@media (prefers-color-scheme: light) {
  :root { --bg:#f6f7f9; --card:#fff; --fg:#111; --muted:#5f6368; --ok:#0b7a45; --bad:#b91c1c; --acc:#0369a1; }
}
body { margin:0; font:14px/1.45 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
main { max-width:920px; margin:0 auto; padding:20px; }
h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
.sub { color:var(--muted); margin-bottom:16px; }
.grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
.card { background:var(--card); border:1px solid color-mix(in srgb, var(--fg) 12%, transparent); border-radius:10px; padding:12px 14px; }
.k { color:var(--muted); font-size:12px; }
.v { font-size:15px; margin-top:4px; word-break:break-all; }
.ok { color:var(--ok); } .bad { color:var(--bad); }
table { width:100%; border-collapse:collapse; font-size:13px; }
td,th { text-align:left; padding:8px 6px; border-bottom:1px solid color-mix(in srgb, var(--fg) 10%, transparent); vertical-align:top; }
a { color:var(--acc); }
pre { white-space:pre-wrap; word-break:break-word; font-size:11px; color:var(--muted); margin:0; }
</style>
</head>
<body>
<main>
  <h1>Сборки на этом Mac</h1>
  <div class="sub">Только jobs с label <code>owner=__OWNER__</code>. Обновление каждые 2 с.</div>
  <div class="grid" id="meta"></div>
  <div class="card" style="margin-top:12px">
    <div class="k">Сейчас выполняется</div>
    <div id="running" style="margin-top:8px"></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="k">Последние события агента</div>
    <pre id="recent" style="margin-top:8px"></pre>
  </div>
</main>
<script>
async function tick(){
  const s = await fetch('/api/status').then(r=>r.json());
  const yes = v => v ? '<span class="ok">да</span>' : '<span class="bad">нет</span>';
  document.getElementById('meta').innerHTML = `
    <div class="card"><div class="k">owner</div><div class="v">${s.owner}</div></div>
    <div class="card"><div class="k">агент</div><div class="v">${yes(s.agentAlive)}</div></div>
    <div class="card"><div class="k">туннель :19000</div><div class="v">${yes(s.tunnelAlive)}</div></div>
    <div class="card"><div class="k">Layero Workspace</div><div class="v"><a href="${s.gatewayUrl}" target="_blank" rel="noreferrer">открыть</a></div></div>`;
  const run = document.getElementById('running');
  if (!s.running.length) {
    run.innerHTML = '<div class="v" style="color:var(--muted)">ничего не собирается</div>';
  } else {
    run.innerHTML = '<table><tr><th>pid</th><th>etime</th><th>command</th></tr>' +
      s.running.map(r => `<tr><td>${r.pid}</td><td>${r.etime}</td><td><code>${r.command.replace(/[<>&]/g, c=>({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]))}</code></td></tr>`).join('') +
      '</table>';
  }
  document.getElementById('recent').textContent = (s.recent||[]).join('\\n') || '—';
}
tick(); setInterval(tick, 2000);
</script>
</body>
</html>
""".replace("__OWNER__", OWNER)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/status":
            body = json.dumps(status_payload()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY
echo $! >"$PID_FILE"
sleep 0.4
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "status-server failed, see $LOG_DIR/status-server.log" >&2
  exit 1
fi
echo "status-server http://127.0.0.1:$PORT pid=$(cat "$PID_FILE")"
