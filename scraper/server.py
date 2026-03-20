#!/usr/bin/env python3
"""
Local scraper server for Research Network.

Runs a tiny HTTP server so the web app's Refresh button can trigger
Selenium scraping from the browser.

Usage:
    python server.py [--port 5555]

The web app sends POST /scrape with JSON body: { "scholarId": "...", "headless": true }
The server streams progress as SSE (Server-Sent Events) and saves the result to data/network.json.
"""

import argparse
import json
import os
import sys
import threading
import time
import queue
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Add parent dir so we can import scraper
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scholar_scraper import scrape_scholar


# Thread-safe progress queue
progress_queues: dict[str, queue.Queue] = {}
scrape_results: dict[str, dict] = {}

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_DIR, "data")


class ScrapeHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/status":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "message": "Scraper server running"}).encode())
            return

        if path == "/data":
            # Return the current network.json
            data_file = os.path.join(DATA_DIR, "network.json")
            if os.path.exists(data_file):
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                with open(data_file, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self._cors()
                self.end_headers()
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/scrape":
            content_len = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_len)) if content_len > 0 else {}

            scholar_id = body.get("scholarId", "")
            headless = body.get("headless", True)
            fetch_full = body.get("fetchFullAuthors", True)

            if not scholar_id:
                self.send_response(400)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "scholarId is required"}).encode())
                return

            # Load existing data for cache
            existing = None
            data_file = os.path.join(DATA_DIR, "network.json")
            if os.path.exists(data_file):
                try:
                    with open(data_file, "r") as f:
                        existing = json.load(f)
                except Exception:
                    pass

            # Run scraping (blocking — the web app shows a loading state)
            try:
                result = scrape_scholar(
                    scholar_id=scholar_id,
                    headless=headless,
                    fetch_full_authors=fetch_full,
                    existing_data=existing,
                )

                # Save to data/network.json
                os.makedirs(DATA_DIR, exist_ok=True)
                with open(data_file, "w", encoding="utf-8") as f:
                    json.dump(result, f, indent=2, ensure_ascii=False)

                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())

            except Exception as e:
                self.send_response(500)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[server] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="Research Network scraper server")
    parser.add_argument("--port", type=int, default=5555, help="Server port (default: 5555)")
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), ScrapeHandler)
    print(f"Scraper server running at http://localhost:{args.port}")
    print(f"  POST /scrape  — trigger a Scholar scrape")
    print(f"  GET  /data    — get current network.json")
    print(f"  GET  /status  — health check")
    print(f"\nPress Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
