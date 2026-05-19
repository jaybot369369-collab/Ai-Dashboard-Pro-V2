#!/usr/bin/env python3
"""
Local AI proxy server for AI Dashboard Pro V2 — port 8770
Routes /chat requests to the Claude Code CLI so the Dojo Top Down Analysis
(and any other dashboard AI feature in local mode) works without spending
Anthropic API credits.

Usage:
    python3 scripts/local_ai_server.py

Keep this running in a terminal while using the dashboard.
In the Dojo tab, click the 🖥️ Local button to enable local mode.
"""
import subprocess, json, sys, textwrap, base64, tempfile, os
from http.server import BaseHTTPRequestHandler, HTTPServer

CLAUDE_CLI = "/Users/claudebot-1/.local/bin/claude"
PORT = 8770

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[local-ai] {fmt % args}")

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"status": "ok", "port": PORT})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/chat"):
            self._send(404, {"error": "not found"}); return
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length))
        system    = body.get("system", "")
        prompt    = body.get("prompt", "")
        img_b64   = body.get("image_b64", "")
        img_mime  = body.get("image_media_type", "image/png")

        # Build the full message for claude --print
        full_prompt = f"[SYSTEM]\n{system}\n\n[USER]\n{prompt}" if system else prompt

        tmp_path = None
        try:
            cmd = [CLAUDE_CLI, "--print"]

            # If image provided: decode to temp file and pass --image flag
            if img_b64:
                ext = img_mime.split("/")[-1].replace("jpeg", "jpg")
                fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}", prefix="chart_scan_")
                with os.fdopen(fd, "wb") as f:
                    f.write(base64.b64decode(img_b64))
                cmd += ["--image", tmp_path]

            cmd.append(full_prompt)

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                err = result.stderr.strip() or f"Claude CLI exited {result.returncode}"
                self._send(500, {"error": err}); return
            self._send(200, {"text": result.stdout})
        except FileNotFoundError:
            self._send(500, {"error": f"Claude CLI not found at {CLAUDE_CLI}. Install Claude Code first."})
        except subprocess.TimeoutExpired:
            self._send(500, {"error": "Claude CLI timed out after 120s"})
        except Exception as e:
            self._send(500, {"error": str(e)})
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

if __name__ == "__main__":
    print(f"[local-ai] Starting on http://127.0.0.1:{PORT}")
    print(f"[local-ai] Claude CLI: {CLAUDE_CLI}")
    print(f"[local-ai] In Dojo tab click 🖥️ Local to route through here.")
    print(f"[local-ai] Press Ctrl+C to stop.\n")
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[local-ai] Stopped.")
