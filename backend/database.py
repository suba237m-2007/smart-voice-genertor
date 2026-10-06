"""SQLite helpers for Smart Voice Generator.

Every query uses parameter placeholders (?) so user input is never
concatenated into SQL.
"""
import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS speech_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    text            TEXT    NOT NULL,
    language        TEXT    NOT NULL,
    voice           TEXT    NOT NULL,
    rate            REAL    NOT NULL,
    pitch           REAL    NOT NULL,
    volume          REAL    NOT NULL,
    word_count      INTEGER NOT NULL,
    character_count INTEGER NOT NULL,
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_speech_history_created_at
    ON speech_history (created_at);
"""

COLUMNS = (
    "id, text, language, voice, rate, pitch, volume, "
    "word_count, character_count, created_at"
)


def get_db():
    """Return the SQLite connection for the current request."""
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(_exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    """Create the database file and table if they do not exist yet."""
    connection = sqlite3.connect(app.config["DATABASE"])
    try:
        connection.executescript(SCHEMA)
        connection.commit()
    finally:
        connection.close()


def init_app(app):
    app.teardown_appcontext(close_db)
    init_db(app)


def ping():
    """Run a trivial query; raises sqlite3.Error if the database is unusable."""
    get_db().execute("SELECT 1").fetchone()


def insert_history(record):
    """Insert a validated record and return the stored row as a dict."""
    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO speech_history
            (text, language, voice, rate, pitch, volume,
             word_count, character_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record["text"],
            record["language"],
            record["voice"],
            record["rate"],
            record["pitch"],
            record["volume"],
            record["word_count"],
            record["character_count"],
            record["created_at"],
        ),
    )
    db.commit()
    return get_history_item(cursor.lastrowid)


def get_history_item(item_id):
    row = get_db().execute(
        f"SELECT {COLUMNS} FROM speech_history WHERE id = ?", (item_id,)
    ).fetchone()
    return dict(row) if row else None


def list_history(limit, offset):
    rows = get_db().execute(
        f"SELECT {COLUMNS} FROM speech_history ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    return [dict(row) for row in rows]


def count_history():
    return get_db().execute("SELECT COUNT(*) FROM speech_history").fetchone()[0]


def delete_history_item(item_id):
    """Delete one record. Returns True if a row was removed."""
    db = get_db()
    cursor = db.execute("DELETE FROM speech_history WHERE id = ?", (item_id,))
    db.commit()
    return cursor.rowcount > 0


def clear_history():
    """Delete every record. Returns the number of rows removed."""
    db = get_db()
    cursor = db.execute("DELETE FROM speech_history")
    db.commit()
    return cursor.rowcount


def get_summary_stats():
    """Aggregate numbers for the dashboard summary."""
    db = get_db()
    totals = db.execute(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(word_count), 0) AS words, "
        "MAX(created_at) AS latest FROM speech_history"
    ).fetchone()
    top_language = db.execute(
        "SELECT language FROM speech_history GROUP BY language "
        "ORDER BY COUNT(*) DESC, MAX(id) DESC LIMIT 1"
    ).fetchone()
    return {
        "total_requests": totals["requests"],
        "total_words": totals["words"],
        "most_used_language": top_language["language"] if top_language else None,
        "recent_activity": totals["latest"],
    }
