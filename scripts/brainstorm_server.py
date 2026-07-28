"""Simple HTTP server for visual brainstorming companion.
Serves HTML files from a content directory, auto-serves newest file.
Watches for events written by the frontend.
"""
import http.server
import json
import os
import sys
import time
import threading
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 52341
PROJECT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.cwd()

SESSION_DIR = PROJECT_DIR / ".superpowers" / "brainstorm" / str(int(time.time()))
CONTENT_DIR = SESSION_DIR / "content"
STATE_DIR = SESSION_DIR / "state"
CONTENT_DIR.mkdir(parents=True, exist_ok=True)
STATE_DIR.mkdir(parents=True, exist_ok=True)

# Write server-info
server_info = {
    "port": PORT,
    "url": f"http://localhost:{PORT}",
    "screen_dir": str(CONTENT_DIR),
    "state_dir": str(STATE_DIR),
    "session_dir": str(SESSION_DIR),
}
(STATE_DIR / "server-info").write_text(json.dumps(server_info, indent=2))

# Read frame template
FRAME_TEMPLATE_PATH = Path(sys.argv[3]) if len(sys.argv) > 3 else None

FRAME_CSS = """
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --muted: #8b949e; --accent: #6366f1;
  --green: #10b981; --amber: #f59e0b; --red: #ef4444;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg); color: var(--text); padding: 40px; line-height: 1.6;
}
.options { display: flex; gap: 16px; flex-wrap: wrap; margin: 24px 0; }
.option {
  background: var(--surface); border: 2px solid var(--border); border-radius: 12px;
  padding: 20px; cursor: pointer; transition: all 0.15s; flex: 1; min-width: 200px;
}
.option:hover { border-color: var(--accent); }
.option.selected { border-color: var(--accent); background: #1a1b2e; }
.letter {
  width: 36px; height: 36px; border-radius: 50%; background: var(--accent);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; margin-bottom: 12px;
}
.cards { display: flex; gap: 16px; flex-wrap: wrap; margin: 24px 0; }
.card {
  background: var(--surface); border: 2px solid var(--border); border-radius: 12px;
  overflow: hidden; cursor: pointer; transition: all 0.15s; flex: 1; min-width: 250px;
}
.card:hover { border-color: var(--accent); }
.card.selected { border-color: var(--accent); background: #1a1b2e; }
.card-image { padding: 24px; min-height: 120px; }
.card-body { padding: 0 20px 20px; }
h2 { font-size: 1.5em; margin-bottom: 8px; }
h3 { font-size: 1.1em; margin-bottom: 4px; }
.subtitle { color: var(--muted); margin-bottom: 8px; }
.mockup { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin: 16px 0; }
.mockup-header { background: #1c2130; padding: 10px 16px; font-size: 0.85em; color: var(--muted); border-bottom: 1px solid var(--border); }
.mockup-body { padding: 20px; }
.mock-nav { background: #1c2130; padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; color: var(--muted); }
.mock-sidebar { background: #1c2130; padding: 16px; border-radius: 8px; width: 180px; min-height: 200px; color: var(--muted); }
.mock-content { background: #1c2130; padding: 16px; border-radius: 8px; flex: 1; min-height: 200px; margin-left: 12px; color: var(--muted); }
.mock-button { background: var(--accent); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 0.9em; cursor: pointer; }
.mock-input { background: var(--bg); border: 1px solid var(--border); padding: 8px 12px; border-radius: 6px; color: var(--text); font-size: 0.9em; }
.split { display: flex; gap: 16px; }
.split > * { flex: 1; }
.placeholder { background: #1c2130; border: 1px dashed var(--border); padding: 24px; border-radius: 8px; text-align: center; color: var(--muted); }
.bar {
  position: fixed; bottom: 0; left: 0; right: 0; background: #1c2130;
  border-top: 1px solid var(--border); padding: 10px 20px; display: none;
  justify-content: space-between; align-items: center;
}
.bar.visible { display: flex; }
.bar-text { font-size: 0.9em; }
.bar-btn {
  background: var(--accent); color: #fff; border: none; padding: 8px 20px;
  border-radius: 6px; cursor: pointer; font-size: 0.9em;
}
pre { background: #0d1117; border: 1px solid var(--border); border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 0.85em; }
code { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.9em; }
"""

FRAME_SCRIPT = """
<script>
let selections = [];
document.querySelectorAll('.option, .card').forEach(el => {
  el.addEventListener('click', function() {
    const isMulti = this.parentElement.dataset.multiselect !== undefined;
    if (!isMulti) {
      document.querySelectorAll('.option.selected, .card.selected').forEach(s => s.classList.remove('selected'));
      selections = [];
    }
    this.classList.toggle('selected');
    const choice = this.dataset.choice;
    if (this.classList.contains('selected')) {
      selections.push(choice);
    } else {
      selections = selections.filter(s => s !== choice);
    }
    const bar = document.getElementById('selection-bar');
    if (selections.length > 0) {
      bar.classList.add('visible');
      bar.querySelector('.bar-text').textContent = 'Selected: ' + selections.join(', ');
    } else {
      bar.classList.remove('visible');
    }
  });
});
function submitSelection() {
  fetch('/event', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type: 'click', choices: selections, timestamp: Date.now()})
  }).then(() => {
    document.getElementById('selection-bar').classList.remove('visible');
    document.querySelectorAll('.option.selected, .card.selected').forEach(s => s.classList.remove('selected'));
    selections = [];
  });
}
</script>
"""

class BrainstormHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CONTENT_DIR), **kwargs)

    def do_POST(self):
        if self.path == '/event':
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length))
            (STATE_DIR / "events").write_text(json.dumps(data, ensure_ascii=False) + "\n")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self._serve_newest()
        elif self.path == '/ping':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'pong')
        else:
            super().do_GET()

    def _serve_newest(self):
        files = sorted(CONTENT_DIR.glob('*.html'), key=lambda p: p.stat().st_mtime, reverse=True)
        if not files:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<html><body style="background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><p>Waiting for content...</p></body></html>'.encode())
            return

        content = files[0].read_text(encoding='utf-8')
        # If content already starts with <!DOCTYPE, serve as-is
        if content.strip().startswith('<!DOCTYPE') or content.strip().startswith('<html'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))
            return

        # Wrap in frame template
        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow Dashboard — Brainstorming</title>
<style>{FRAME_CSS}</style>
</head>
<body>
{content}
<div id="selection-bar" class="bar"><span class="bar-text"></span><button class="bar-btn" onclick="submitSelection()">Confirm</button></div>
{FRAME_SCRIPT}
</body>
</html>"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))

    def log_message(self, format, *args):
        pass  # Silent

print(json.dumps(server_info))
sys.stdout.flush()

server = http.server.HTTPServer(('127.0.0.1', PORT), BrainstormHandler)
server.serve_forever()
