#!/usr/bin/env python3
"""Dev server: serves the repo over http and lets the MIDI monitor post logs back.

    python3 tools/devserver.py [port]

GET  /...       static files from the repo root (no caching, so a refresh always gets the latest)
POST /log       body is JSON lines; each line is appended to .midi-log.jsonl in the repo root
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, '.midi-log.jsonl')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path.startswith('/upload'):
            return self.upload()
        if self.path != '/log':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(min(length, 1_000_000)).decode('utf-8', 'replace')
        with open(LOG, 'a') as f:
            for line in body.splitlines():
                if line.strip():
                    f.write(line.strip() + '\n')
        self.send_response(204)
        self.end_headers()

    # POST /upload?name=<file>: saves the body into circuit/incoming/ (gitignored).
    def upload(self):
        from urllib.parse import urlparse, parse_qs
        name = parse_qs(urlparse(self.path).query).get('name', ['upload.bin'])[0]
        name = os.path.basename(name).replace('..', '') or 'upload.bin'
        length = int(self.headers.get('Content-Length', 0))
        if length > 20_000_000:
            self.send_error(413)
            return
        folder = os.path.join(ROOT, 'circuit', 'incoming')
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, name), 'wb') as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.command == 'POST':
            return  # don't spam the console with log posts
        super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Serving {ROOT} on 0.0.0.0:{port}', flush=True)
    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
