"""Smart Voice Generator - application entry point.

Run with:
    python app.py
Then open http://127.0.0.1:5000 in your browser.
"""
import os

from backend import create_app

app = create_app()

if __name__ == "__main__":
    # Local development settings: bind to the loopback interface only, so the
    # app is not reachable from other machines. Set SVG_DEBUG=0 to turn off
    # the auto-reloader and debugger.
    debug_enabled = os.environ.get("SVG_DEBUG", "1") != "0"
    app.run(host="127.0.0.1", port=5000, debug=debug_enabled)
