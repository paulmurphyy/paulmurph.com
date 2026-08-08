"""Static file server for local preview.

python -m http.server ignores the Range header, so Chrome marks the mp3 as
unseekable and the player's seek bar does nothing. github pages serves
Accept-Ranges: bytes, so this only bites locally — this adds range support
so the preview behaves like the deployed site.

    python .claude/serve.py [port]
"""

import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


class _Slice:
    """reads at most `length` bytes, so copyfile stops at the end of the range"""

    def __init__(self, f, length):
        self.f, self.left = f, length

    def read(self, n=-1):
        if self.left <= 0:
            return b""
        if n is None or n < 0 or n > self.left:
            n = self.left
        data = self.f.read(n)
        self.left -= len(data)
        return data

    def close(self):
        self.f.close()


class RangeHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        # no cache headers otherwise, so chrome heuristically caches css/js and
        # serves stale files after an edit
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def copyfile(self, source, outputfile):
        # media elements abort requests routinely; that isn't worth a traceback
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def send_head(self):
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        m = RANGE.match(header.strip()) if header else None
        if not m or os.path.isdir(path):
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        first, last = m.groups()
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        elif last:                       # suffix range: the trailing N bytes
            start, end = max(0, size - int(last)), size - 1
        else:
            f.close()
            self.send_error(400, "Malformed Range header")
            return None
        end = min(end, size - 1)

        if start >= size or start > end:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return _Slice(f, end - start + 1)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8017
    handler = partial(RangeHandler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{port}")
        httpd.serve_forever()
