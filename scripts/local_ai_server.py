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
import os, subprocess, json, sys, base64, hmac
from http.server import BaseHTTPRequestHandler, HTTPServer

CLAUDE_CLI = "/Users/claudebot-1/.local/bin/claude"
PORT = 8770
SHIM_TOKEN = os.environ.get("LOCAL_SHIM_TOKEN", "").strip()


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

    def do_POST(self):
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

        # Build the full message for claude --print
        full_prompt = f"[SYSTEM]\n{system}\n\n[USER]\n{prompt}" if system else prompt

        try:
            if img_b64:
                # Vision path: use stream-json to pass image content block
                user_content = [
                    {"type": "image", "source": {"type": "base64",
                                                  "media_type": img_mime,
                                                  "data": img_b64}},
                    {"type": "text", "text": prompt},
                ]
                lines = []
                if system:
                    lines.append(json.dumps({"type": "system", "system": system}))
                lines.append(json.dumps({"type": "user", "message":
                                          {"role": "user", "content": user_content}}))
                stdin_data = "\n".join(lines)
                cmd = [CLAUDE_CLI, "--print", "--verbose",
                       "--allowedTools", "",   # pure Q&A — no file/bash tools
                       "--input-format=stream-json", "--output-format=stream-json"]
                result = subprocess.run(cmd, input=stdin_data,
                                        capture_output=True, text=True, timeout=180)
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
                # Text-only path — use stream-json so the system prompt
                # is delivered as a proper system message instead of being
                # text-prefixed (which Claude correctly rejects as prompt
                # injection). Same --allowedTools "" lockdown.
                lines = []
                if system:
                    lines.append(json.dumps({"type": "system", "system": system}))
                lines.append(json.dumps({"type": "user", "message":
                                          {"role": "user", "content": prompt}}))
                stdin_data = "\n".join(lines)
                cmd = [CLAUDE_CLI, "--print", "--verbose",
                       "--allowedTools", "",
                       "--input-format=stream-json", "--output-format=stream-json"]
                result = subprocess.run(cmd, input=stdin_data,
                                        capture_output=True, text=True, timeout=120)
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
        except FileNotFoundError:
            self._send(500, {"error": f"Claude CLI not found at {CLAUDE_CLI}. Install Claude Code first."})
        except subprocess.TimeoutExpired:
            self._send(500, {"error": "Claude CLI timed out (180s). Large image? Try a smaller crop."})
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
