"""REST API endpoints for Smart Voice Generator."""
import sqlite3
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from . import database, models

api = Blueprint("api", __name__)

DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500


@api.errorhandler(models.ValidationError)
def handle_validation_error(error):
    body = {"error": {"code": "validation_error", "message": error.message}}
    if error.field:
        body["error"]["field"] = error.field
    return jsonify(body), 400


def _json_body():
    """Return the request JSON as a dict or raise a friendly validation error."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise models.ValidationError("Request body must be a JSON object.")
    return payload


def _int_arg(name, default, low, high):
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise models.ValidationError(f"'{name}' must be a whole number.", name)
    if value < low or value > high:
        raise models.ValidationError(f"'{name}' must be between {low} and {high}.", name)
    return value


@api.get("/health")
def health():
    """Report whether the server and database are working."""
    try:
        database.ping()
        database_status = "ok"
    except sqlite3.Error:
        database_status = "error"
    healthy = database_status == "ok"
    body = {
        "status": "ok" if healthy else "degraded",
        "database": database_status,
        "max_text_length": models.MAX_TEXT_LENGTH,
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return jsonify(body), 200 if healthy else 503


@api.post("/analyze")
def analyze():
    """Analyse text on the server. The home page does this locally as well."""
    payload = _json_body()
    text = models.validate_text(payload.get("text"))
    rate = models.validate_rate_for_analysis(payload)
    return jsonify({"analysis": models.analyze_text(text, rate)})


@api.post("/history")
def create_history():
    """Store one speech-generation request."""
    record = models.validate_history_payload(_json_body())
    item = database.insert_history(record)
    return jsonify({"item": item}), 201


@api.get("/history")
def list_history():
    limit = _int_arg("limit", DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    offset = _int_arg("offset", 0, 0, 10**9)
    return jsonify(
        {
            "items": database.list_history(limit, offset),
            "total": database.count_history(),
            "limit": limit,
            "offset": offset,
        }
    )


@api.delete("/history/<int:item_id>")
def delete_history(item_id):
    if not database.delete_history_item(item_id):
        return jsonify({"error": {"code": "not_found", "message": "That history item no longer exists."}}), 404
    return jsonify({"deleted": item_id})


@api.delete("/history")
def clear_history():
    """Remove every history record."""
    return jsonify({"deleted": database.clear_history()})


@api.get("/stats")
def stats():
    """Numbers for the dashboard summary on the home page."""
    return jsonify(database.get_summary_stats())
