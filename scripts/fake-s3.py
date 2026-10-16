"""A local S3-compatible bucket for backup tests: path-style PUT, GET, DELETE and ListObjectsV2, stored as files.

It requires a SigV4 Authorization header on every request but does not verify the signature; the signer is tested
against botocore's output in the unit tests. Usage: python3 scripts/fake-s3.py PORT DIRECTORY
"""
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse
from xml.sax.saxutils import escape

ROOT = os.path.abspath(sys.argv[2])


class Bucket(BaseHTTPRequestHandler):
    def _target(self):
        url = urlparse(self.path)
        parts = unquote(url.path).lstrip("/").split("/", 1)
        bucket, key = parts[0], (parts[1] if len(parts) > 1 else "")
        return bucket, key, parse_qs(url.query)

    def _authorized(self):
        if not self.headers.get("Authorization", "").startswith("AWS4-HMAC-SHA256 Credential="):
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def _path(self, bucket, key):
        path = os.path.abspath(os.path.join(ROOT, bucket, key))
        assert path.startswith(ROOT + os.sep)
        return path

    def do_PUT(self):
        if not self._authorized():
            return
        bucket, key, _ = self._target()
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        path = self._path(bucket, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if not self._authorized():
            return
        bucket, key, query = self._target()
        if not key and query.get("list-type") == ["2"]:
            prefix = query.get("prefix", [""])[0]
            base = os.path.join(ROOT, bucket)
            keys = []
            for directory, _, files in os.walk(base):
                for name in files:
                    rel = os.path.relpath(os.path.join(directory, name), base)
                    if rel.startswith(prefix):
                        keys.append(rel)
            xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ListBucketResult><IsTruncated>false</IsTruncated>"
            xml += "".join(f"<Contents><Key>{escape(k)}</Key></Contents>" for k in sorted(keys))
            xml += "</ListBucketResult>"
            data = xml.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        path = self._path(bucket, key)
        if not os.path.isfile(path):
            self.send_response(404)
            self.end_headers()
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_DELETE(self):
        if not self._authorized():
            return
        bucket, key, _ = self._target()
        path = self._path(bucket, key)
        if os.path.isfile(path):
            os.remove(path)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Bucket).serve_forever()
