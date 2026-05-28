#!/usr/bin/env python3
"""
Lightweight API server to bridge Spark GraphX results to the frontend.
Reads /tmp/pagerank_results.json written by SocialGraphApp after each batch
and exposes it at http://localhost:5000/api/results
"""

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

RESULTS_PATH = "/tmp/pagerank_results.json"
PORT = 5000


class APIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default request logging; print clean messages instead
        print(f"[API] {self.address_string()} - {format % args}")

    def _send_cors_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._send_cors_headers(200)

    def do_GET(self):
        if self.path == "/api/results":
            if os.path.exists(RESULTS_PATH):
                try:
                    with open(RESULTS_PATH, "r") as f:
                        data = f.read()
                    # Validate JSON
                    json.loads(data)
                    self._send_cors_headers(200)
                    self.wfile.write(data.encode("utf-8"))
                except (json.JSONDecodeError, IOError) as e:
                    self._send_cors_headers(500)
                    self.wfile.write(json.dumps({"error": str(e)}).encode())
            else:
                # Spark hasn't written results yet
                self._send_cors_headers(202)
                self.wfile.write(json.dumps({
                    "status": "waiting",
                    "message": "Spark pipeline is starting up, no results yet."
                }).encode("utf-8"))
        elif self.path == "/api/health":
            self._send_cors_headers(200)
            self.wfile.write(json.dumps({
                "status": "ok",
                "results_ready": os.path.exists(RESULTS_PATH)
            }).encode("utf-8"))
        else:
            self._send_cors_headers(404)
            self.wfile.write(json.dumps({"error": "Not found"}).encode())


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), APIHandler)
    print(f"[API] Server started at http://localhost:{PORT}")
    print(f"[API] Watching results file: {RESULTS_PATH}")
    print(f"[API] Endpoints:")
    print(f"[API]   GET http://localhost:{PORT}/api/results  - Latest PageRank results")
    print(f"[API]   GET http://localhost:{PORT}/api/health   - Health check")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[API] Server stopped.")
