#!/usr/bin/env python3
"""Serveur local de developpement du widget, sans cache navigateur (chaque modification est vue
au rechargement). Usage : python outils/serveur_dev.py [port]  -> http://localhost:4180/
Pour un essai dans Grist : URL personnalisee http://localhost:4180/index.html (meme PC)."""
import http.server
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SansCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RACINE, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4180
    http.server.ThreadingHTTPServer(("127.0.0.1", port), SansCache).serve_forever()
