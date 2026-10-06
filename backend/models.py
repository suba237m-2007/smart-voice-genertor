"""Validation and text-analysis helpers for Smart Voice Generator."""
import math
import re
from datetime import datetime, timezone

MAX_TEXT_LENGTH = 5000  # Keep in sync with MAX_LENGTH in frontend/js/analysis.js
RATE_RANGE = (0.5, 2.0)
PITCH_RANGE = (0.0, 2.0)
VOLUME_RANGE = (0.0, 100.0)  # percent

READING_WORDS_PER_MINUTE = 200
SPEAKING_WORDS_PER_MINUTE = 150  # at a speech rate of 1.0x

EMPTY_TEXT_MESSAGE = "Please enter some text before generating speech."

# Control characters except tab (\x09), newline (\x0a) and carriage return (\x0d).
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# A sentence is a run of text followed by . ! ? the Devanagari danda or an ellipsis.
_SENTENCE_RE = re.compile(r"[^.!?\u0964\u2026]+[.!?\u0964\u2026]*")
_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$")


class ValidationError(ValueError):
    """Raised when incoming data is invalid. The message is safe to show to users."""

    def __init__(self, message, field=None):
        super().__init__(message)
        self.message = message
        self.field = field


def _has_letter_or_digit(value):
    return any(char.isalnum() for char in value)


def clean_text(value):
    """Normalise line endings and remove control characters."""
    return _CONTROL_CHARS.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))


def _round_half_up(number):
    return int(math.floor(number + 0.5))


def _duration_seconds(words, words_per_minute, speed=1.0):
    if words == 0:
        return 0
    return max(1, _round_half_up(words / (words_per_minute * speed) * 60))


def analyze_text(text, rate=1.0):
    """Return the text statistics shown on the home page.

    The same rules are implemented in frontend/js/analysis.js.
    """
    words = [token for token in text.split() if _has_letter_or_digit(token)]
    sentences = [part for part in _SENTENCE_RE.findall(text) if _has_letter_or_digit(part)]
    paragraphs = [block for block in re.split(r"\n\s*\n", text) if block.strip()]
    word_count = len(words)
    sentence_count = len(sentences)
    return {
        "characters": len(text),
        "characters_no_spaces": len(re.sub(r"\s", "", text)),
        "words": word_count,
        "sentences": sentence_count,
        "paragraphs": len(paragraphs),
        "avg_words_per_sentence": round(word_count / sentence_count, 1) if sentence_count else 0,
        "reading_time_seconds": _duration_seconds(word_count, READING_WORDS_PER_MINUTE),
        "speaking_time_seconds": _duration_seconds(word_count, SPEAKING_WORDS_PER_MINUTE, rate),
    }


def validate_text(value):
    """Return cleaned text or raise ValidationError."""
    if not isinstance(value, str):
        raise ValidationError("Text must be a string.", "text")
    text = clean_text(value).strip()
    if not text:
        raise ValidationError(EMPTY_TEXT_MESSAGE, "text")
    if len(text) > MAX_TEXT_LENGTH:
        raise ValidationError(
            f"Text is too long. The limit is {MAX_TEXT_LENGTH:,} characters "
            f"and you entered {len(text):,}.",
            "text",
        )
    return text


def validate_number(payload, field, low, high, label):
    value = payload.get(field)
    # bool is a subclass of int in Python, so exclude it explicitly.
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(f"{label} must be a number.", field)
    if value < low or value > high:
        raise ValidationError(f"{label} must be between {low:g} and {high:g}.", field)
    return float(value)


def validate_rate_for_analysis(payload):
    """The analyze endpoint accepts an optional speech rate."""
    if "rate" not in payload or payload["rate"] is None:
        return 1.0
    return validate_number(payload, "rate", *RATE_RANGE, "Speech rate")


def validate_history_payload(payload):
    """Validate a POST /api/history body and return a record ready to store."""
    text = validate_text(payload.get("text"))

    language = payload.get("language")
    if not isinstance(language, str) or not _LANGUAGE_RE.match(language.strip()):
        raise ValidationError("Language must be a code such as en-US or ta-IN.", "language")
    language = language.strip().replace("_", "-")

    voice = payload.get("voice")
    if not isinstance(voice, str):
        raise ValidationError("Voice name must be a string.", "voice")
    voice = clean_text(voice).strip()
    if not voice or len(voice) > 200:
        raise ValidationError("Voice name must be between 1 and 200 characters.", "voice")

    analysis = analyze_text(text)
    return {
        "text": text,
        "language": language,
        "voice": voice,
        "rate": validate_number(payload, "rate", *RATE_RANGE, "Speech rate"),
        "pitch": validate_number(payload, "pitch", *PITCH_RANGE, "Pitch"),
        "volume": validate_number(payload, "volume", *VOLUME_RANGE, "Volume"),
        "word_count": analysis["words"],
        "character_count": analysis["characters"],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
