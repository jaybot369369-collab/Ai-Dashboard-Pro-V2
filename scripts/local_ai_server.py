#!/usr/bin/env python3
"""
Local AI proxy server for AI Dashboard Pro V2 — port 8770
Routes /chat requests to the Claude Code CLI so the dashboard's AI
features (Scan Trade, Top Down Analysis, AI Coach insights, etc.) work
without spending Anthropic API credits.

Usage:
    python3 ~/.local/bin/local_ai_server.py

Auth:
    Optional but STRONGLY recommended when exposing this shim via a
    Cloudflare quick-tunnel. Set the env var LOCAL_SHIM_TOKEN to a
    random string and the server will require requests to carry
    X-Shim-Token: <same value>. Without a token, the server accepts
    any caller — safe ONLY when bound to 127.0.0.1 with no tunnel.

    Example:
        LOCAL_SHIM_TOKEN=$(openssl rand -hex 24) python3 ~/.local/bin/local_ai_server.py
        echo $LOCAL_SHIM_TOKEN  # paste this into dashboard

Safety:
    Both /chat code paths pass `--allowedTools ""` to the Claude CLI so
    the spawned session cannot use Bash / Read / Write / Edit tools.
    The shim is effectively a pure Q&A surface — model thinking + text,
    no file access, no shell, no network from the model side.
"""
import os, subprocess, json, sys, base64, hmac, socket, time
from http.server import BaseHTTPRequestHandler, HTTPServer

CLAUDE_CLI = "/Users/claudebot-1/.local/bin/claude"
PORT = 8770
SHIM_TOKEN = os.environ.get("LOCAL_SHIM_TOKEN", "").strip()

# ── ICT TV Replay Trainer — "start on click" target ──────────────────
# The AI Coach "ICT Trainer" button POSTs /launch-trainer here; we boot the
# trainer's Node bridge (serves the HUD on :8800) if it isn't already up.
TRAINER_DIR  = "/Users/claudebot-1/Documents/Claude/Q2_2026/ICT_Methodology/skill/trainers/ict_tv_replay_trainer"
TRAINER_PORT = 8800
NODE_BIN     = "/usr/local/bin/node"

# ── Day Trade Scanner — "start on click" target ───────────────────────
# The Scanner tab's 📡 Day Trade Scanner button POSTs /launch-scanner here;
# we boot Signal Deck's Python server (serves the UI on :8771) if not up.
SCANNER_DIR  = "/Users/claudebot-1/Documents/Claude/Q2_2026/_CLAUDE PROJECTS/Signal Deck"
SCANNER_PORT = 8771
PYTHON_BIN   = "/usr/bin/python3"

# ── Sensei coach — "run on click" (FREE, local Claude CLI) ───────────
# The Bot Farm tab's 🧠 Run Sensei button POSTs /run-sensei here; we
# fire the local Sensei runner which generates a report with the local
# Claude CLI (no API spend) and POSTs it to the cloud (fund.db). Fire-
# and-forget: it takes 1-3 min, then shows up on the dashboard refresh.
FUND_DIR = "/Users/claudebot-1/Documents/Claude/Q2_2026/_CLAUDE PROJECTS/Mini Hedge Fund"


def _port_alive(port: int, timeout: float = 0.5) -> bool:
    """True if something is LISTENing on 127.0.0.1:port. Raw TCP check —
    the trainer's own /health stalls while TradingView CDP is down, so we
    never HTTP-probe it for readiness."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[local-ai] {fmt % args}")

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-shim-token")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-shim-token")
        self.end_headers()

    def _auth_ok(self) -> bool:
        """If LOCAL_SHIM_TOKEN is set, require a matching X-Shim-Token
        header on every non-health request. Constant-time compare."""
        if not SHIM_TOKEN:
            return True   # no token configured → open (localhost-only default)
        supplied = (self.headers.get("X-Shim-Token", "") or "").strip()
        return hmac.compare_digest(SHIM_TOKEN, supplied)

    def _launch_trainer(self):
        """Boot the ICT TV Replay Trainer bridge (node bridge.js -> :8800) on
        demand. Idempotent: if :8800 is already up we just report that. The
        spawned process is detached so it outlives this request and server."""
        if not self._auth_ok():
            self._send(403, {"error": "bad or missing X-Shim-Token"}); return
        url = f"http://localhost:{TRAINER_PORT}"
        if _port_alive(TRAINER_PORT):
            self._send(200, {"ok": True, "already": True, "url": url}); return
        if not os.path.isfile(os.path.join(TRAINER_DIR, "bridge.js")):
            self._send(500, {"ok": False, "error": f"bridge.js not found in {TRAINER_DIR}"}); return
        try:
            logf = open("/tmp/ict_tv_trainer.log", "ab")
            subprocess.Popen(
                [NODE_BIN, "bridge.js"], cwd=TRAINER_DIR,
                stdout=logf, stderr=subprocess.STDOUT, start_new_session=True,
            )
            logf.close()
        except Exception as e:
            self._send(500, {"ok": False, "error": f"spawn failed: {e}"}); return
        deadline = time.time() + 12
        while time.time() < deadline:
            if _port_alive(TRAINER_PORT):
                self._send(200, {"ok": True, "started": True, "url": url}); return
            time.sleep(0.5)
        self._send(500, {"ok": False,
                         "error": "bridge spawned but :8800 never came up — see /tmp/ict_tv_trainer.log"}); return

    def do_GET(self):
        if self.path.startswith("/health"):
            # /health is intentionally unauth so dashboards can probe it
            # without the token; reveals only "alive + token required?"
            self._send(200, {
                "status": "ok",
                "port": PORT,
                "auth_required": bool(SHIM_TOKEN),
            })
        else:
            self._send(404, {"error": "not found"})

    def _launch_scanner(self):
        """Boot Signal Deck (python3 server.py -> :8771) on demand.
        Idempotent: if :8771 is already up, just report that. Detached so
        it outlives the request and the shim server."""
        if not self._auth_ok():
            self._send(403, {"error": "bad or missing X-Shim-Token"}); return
        url = f"http://localhost:{SCANNER_PORT}"
        if _port_alive(SCANNER_PORT):
            self._send(200, {"ok": True, "already": True, "url": url}); return
        if not os.path.isfile(os.path.join(SCANNER_DIR, "server.py")):
            self._send(500, {"ok": False, "error": f"server.py not found in {SCANNER_DIR}"}); return
        try:
            # TCC wall: subprocess.Popen loses FDA for ~/Documents (launchd child).
            # `do shell script` in osascript also lacks FDA from launchd.
            # `tell application Terminal to do script` requires Automation TCC
            # (kTCCServiceAppleEvents), which hangs if not pre-granted.
            #
            # Clean fix: write a .command launcher to /tmp (no TCC restriction),
            # then use `open -g` (Launch Services, no TCC needed).
            # Terminal opens the .command file, inherits Terminal's FDA, and
            # python3 within that shell can read ~/Documents. -g keeps it in
            # background so it doesn't steal focus. The "Process completed" window
            # can be closed manually by the user (Cmd+W) if it bother them.
            import stat as _stat
            cmd_file = '/tmp/launch_signal_deck.command'
            with open(cmd_file, 'w') as _f:
                _f.write('#!/bin/bash\n')
                _f.write(f"cd '{SCANNER_DIR}'\n")
                _f.write('nohup python3 server.py >> /tmp/signal_deck.log 2>&1 &\n')
                _f.write('exit 0\n')
            os.chmod(cmd_file,
                     _stat.S_IRWXU | _stat.S_IRGRP | _stat.S_IXGRP |
                     _stat.S_IROTH | _stat.S_IXOTH)   # 0o755
            subprocess.Popen(
                ['open', '-g', cmd_file],   # -g = background, no focus steal
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            self._send(500, {"ok": False, "error": f"spawn failed: {e}"}); return
        deadline = time.time() + 12
        while time.time() < deadline:
            if _port_alive(SCANNER_PORT):
                self._send(200, {"ok": True, "started": True, "url": url}); return
            time.sleep(0.5)
        self._send(500, {"ok": False,
                         "error": "server spawned but :8771 never came up — see /tmp/signal_deck.log"}); return

    def _run_sensei(self):
        """Fire the FREE local Sensei runner (python3 -m fund.tools.sensei_local).
        Generates a coach report with the local Claude CLI (no API spend) and
        POSTs it to the cloud. Fire-and-forget — returns immediately; the
        report appears on the dashboard after ~1-3 min on refresh."""
        if not self._auth_ok():
            self._send(403, {"error": "bad or missing X-Shim-Token"}); return
        if not os.path.isdir(os.path.join(FUND_DIR, "fund", "tools")):
            self._send(500, {"ok": False, "error": f"fund pkg not found in {FUND_DIR}"}); return
        try:
            # Same TCC-safe /tmp .command + `open -g` pattern as the scanner:
            # a launchd-managed python3 loses FDA for ~/Documents, but a
            # Terminal-launched .command inherits Terminal's FDA.
            import stat as _stat
            cmd_file = '/tmp/run_sensei_local.command'
            with open(cmd_file, 'w') as _f:
                _f.write('#!/bin/bash\n')
                _f.write(f"cd '{FUND_DIR}'\n")
                _f.write('PYTHONPATH="." nohup python3 -m fund.tools.sensei_local '
                         '>> /tmp/sensei_local.log 2>&1 &\n')
                _f.write('exit 0\n')
            os.chmod(cmd_file,
                     _stat.S_IRWXU | _stat.S_IRGRP | _stat.S_IXGRP |
                     _stat.S_IROTH | _stat.S_IXOTH)
            subprocess.Popen(['open', '-g', cmd_file], start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            self._send(500, {"ok": False, "error": f"spawn failed: {e}"}); return
        self._send(200, {"ok": True, "started": True,
                         "note": "Sensei is generating a report (1-3 min) — refresh the panel."})

    def do_POST(self):
        if self.path.startswith("/launch-trainer"):
            return self._launch_trainer()
        if self.path.startswith("/launch-scanner"):
            return self._launch_scanner()
        if self.path.startswith("/run-sensei"):
            return self._run_sensei()
        if not self.path.startswith("/chat"):
            self._send(404, {"error": "not found"}); return
        if not self._auth_ok():
            self._send(403, {"error": "bad or missing X-Shim-Token"}); return

        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length))
        system    = body.get("system", "")
        prompt    = body.get("prompt", "")
        img_b64   = body.get("image_b64", "")
        img_mime  = body.get("image_media_type", "image/png")

        # The system prompt MUST be delivered via the --append-system-prompt
        # flag. Passing it as a stream-json {"type":"system"} line does NOT
        # work — the CLI ignores it, so the model never sees the instructions
        # and just replies conversationally ("what would you like me to do
        # with these trades?"). Text-prefixing ([SYSTEM]...[USER]...) is also
        # wrong — Claude treats it as an injected user turn. The flag is the
        # only correct path.
        try:
            if img_b64:
                # Vision path: stream-json input is required to carry the
                # image content block; system still goes via the flag.
                user_content = [
                    {"type": "image", "source": {"type": "base64",
                                                  "media_type": img_mime,
                                                  "data": img_b64}},
                    {"type": "text", "text": prompt},
                ]
                stdin_data = json.dumps({"type": "user", "message":
                                         {"role": "user", "content": user_content}})
                cmd = [CLAUDE_CLI, "--print", "--verbose",
                       "--tools", "",   # pure Q&A — disable ALL file/bash tools
                       "--input-format=stream-json", "--output-format=stream-json"]
                if system:
                    cmd += ["--append-system-prompt", system]
                result = subprocess.run(cmd, input=stdin_data,
                                        capture_output=True, text=True, timeout=420)
                if result.returncode != 0:
                    err = result.stderr.strip() or f"Claude CLI exited {result.returncode}"
                    self._send(500, {"error": err}); return
                # Extract text from stream-json output lines
                text_parts = []
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        if obj.get("type") == "assistant":
                            for block in obj.get("message", {}).get("content", []):
                                if block.get("type") == "text":
                                    text_parts.append(block["text"])
                    except json.JSONDecodeError:
                        pass
                self._send(200, {"text": "".join(text_parts)})
            else:
                # Text-only path — plain --print with the user prompt on stdin
                # and the system prompt via --append-system-prompt. Plain text
                # output (no stream-json), so no parsing needed.
                cmd = [CLAUDE_CLI, "--print", "--tools", ""]
                if system:
                    cmd += ["--append-system-prompt", system]
                # Long timeout: a full weekly review with many trades can take
                # 2-3 min of model time. 420s leaves headroom.
                result = subprocess.run(cmd, input=prompt,
                                        capture_output=True, text=True, timeout=420)
                if result.returncode != 0:
                    err = result.stderr.strip() or f"Claude CLI exited {result.returncode}"
                    self._send(500, {"error": err}); return
                self._send(200, {"text": result.stdout.strip()})
        except FileNotFoundError:
            self._send(500, {"error": f"Claude CLI not found at {CLAUDE_CLI}. Install Claude Code first."})
        except subprocess.TimeoutExpired:
            self._send(500, {"error": "Claude CLI timed out (420s). Try fewer trades in the window, or retry."})
        except Exception as e:
            self._send(500, {"error": str(e)})


if __name__ == "__main__":
    print(f"[local-ai] Starting on http://127.0.0.1:{PORT}")
    print(f"[local-ai] Claude CLI: {CLAUDE_CLI}")
    if SHIM_TOKEN:
        print(f"[local-ai] AUTH:    on — clients must send X-Shim-Token: <your token>")
    else:
        print(f"[local-ai] AUTH:    OFF — safe only when bound to 127.0.0.1 with no tunnel.")
        print(f"[local-ai]                 To enable: LOCAL_SHIM_TOKEN=<rand> python3 ~/.local/bin/local_ai_server.py")
    print(f"[local-ai] Tool lockdown: --allowedTools '' (CLI cannot spawn Bash/Read/Write)")
    print(f"[local-ai] Press Ctrl+C to stop.\n")
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[local-ai] Stopped.")
