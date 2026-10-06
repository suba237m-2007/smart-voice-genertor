"""Smart Voice Generator - Flask application factory."""
import logging
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from . import database
from .routes import api

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
AUDIO_DIR = BASE_DIR / "static" / "audio"

# Clean URLs and their matching HTML files.
PAGES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/history": "history.html",
    "/history.html": "history.html",
    "/about": "about.html",
    "/about.html": "about.html",
}

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

logger = logging.getLogger("smart_voice_generator")


def create_app(test_config=None):
    """Build and configure the Flask application."""
    # static_folder=None: static files are served by the explicit routes below.
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DATABASE=str(BASE_DIR / "database.db"),
        MAX_CONTENT_LENGTH=64 * 1024,  # Reject request bodies larger than 64 KB.
        SEND_FILE_MAX_AGE_DEFAULT=0,  # Always serve fresh files while developing.
    )
    if test_config:
        app.config.update(test_config)

    database.init_app(app)
    app.register_blueprint(api, url_prefix="/api")

    _register_pages(app)
    _register_error_handlers(app)
    _register_security_headers(app)
    return app


def _register_pages(app):
    """Serve the HTML pages and the css/js/audio assets."""

    def make_page_view(filename):
        def view():
            return send_from_directory(FRONTEND_DIR, filename)

        return view

    for index, (rule, filename) in enumerate(PAGES.items()):
        app.add_url_rule(rule, endpoint=f"page_{index}", view_func=make_page_view(filename))

    @app.get("/css/<path:filename>")
    def css_files(filename):
        return send_from_directory(FRONTEND_DIR / "css", filename)

    @app.get("/js/<path:filename>")
    def js_files(filename):
        return send_from_directory(FRONTEND_DIR / "js", filename)

    @app.get("/audio/<path:filename>")
    def audio_files(filename):
        # Generated audio files (if a server-side TTS engine is added later).
        return send_from_directory(AUDIO_DIR, filename)

    @app.get("/favicon.ico")
    def favicon():
        # The pages use an inline SVG icon; answer quietly if a browser asks anyway.
        return "", 204


def _json_error(status, code, message):
    return jsonify({"error": {"code": code, "message": message}}), status


def _register_error_handlers(app):
    """Return JSON errors for the API and keep the server from crashing."""

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        if request.path.startswith("/api/"):
            messages = {
                400: "The request could not be understood.",
                404: "That API endpoint or record was not found.",
                405: "That method is not allowed for this endpoint.",
                413: "The request is too large.",
            }
            message = messages.get(error.code, error.description or "Request failed.")
            return _json_error(error.code, error.name.lower().replace(" ", "_"), message)
        return error

    @app.errorhandler(sqlite3.Error)
    def handle_database_error(error):
        logger.exception("Database error: %s", error)
        return _json_error(500, "database_error", "A database error occurred. Please try again.")

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        logger.exception("Unexpected error: %s", error)
        if request.path.startswith("/api/"):
            return _json_error(500, "server_error", "Something went wrong on the server.")
        return "Something went wrong on the server.", 500


def _register_security_headers(app):
    @app.after_request
    def add_headers(response):
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
