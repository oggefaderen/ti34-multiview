#!/usr/bin/env python3
"""Static dev server for the calculator UI, with caching disabled.

Browsers cache ES modules aggressively, and `python3 -m http.server` happily
serves 304s — so editing an engine module and reloading can silently leave the
old code running, which looks exactly like "my fix didn't work". This sends
no-store on everything.

    python3 tools/serve.py [port]      # default 8000

then open http://localhost:<port>/src/ui/index.html

`file://` will not work: ES module imports are CORS-checked and a file://
origin can never satisfy that check.
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter output
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"serving http://localhost:{port}/src/ui/index.html  (no cache)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
