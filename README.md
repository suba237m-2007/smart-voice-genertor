# Smart Voice Generator – Text-to-Speech Application

A web-based Text-to-Speech application built for a **Text and Speech Analysis** subject project. It analyses the text you enter, lets you choose a voice and delivery settings, speaks the text aloud, and keeps a history of your requests.

## Description

Smart Voice Generator runs locally on a Flask server. The browser handles speech through the Web Speech API, and the Flask backend stores a history of speech requests in SQLite. Text statistics are calculated instantly in the browser and can also be requested from the server.

## Features

- Text editor with live character, word and sentence counters and a 5,000 character limit
- Paste, Copy and Clear buttons
- Text statistics: characters (with and without spaces), words, sentences, paragraphs, average words per sentence, reading time and speaking time
- Voice and language selection from the voices your device actually provides
- Speed (0.5x–2.0x), pitch (0.0–2.0) and volume (0–100%) controls
- Play, Pause, Resume and Stop with a "Speaking..." indicator and sound-wave animation
- Voice preview using a short sample sentence
- History page with Use Again, Delete and Clear History (with confirmation)
- Dashboard summary: total requests, total words, most used language, recent activity
- Settings panel (default language, speed, pitch, volume, dark mode, clear history) saved in `localStorage`
- Light and dark themes, responsive layout, keyboard-friendly and screen-reader-friendly markup
- **Audio download is deliberately not offered** (see Browser Compatibility)

## Technologies Used

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Speech | Web Speech API (`SpeechSynthesis`) |
| Backend | Python, Flask (REST API) |
| Database | SQLite (`sqlite3` from the Python standard library) |

No frontend framework and no icon library are used, so the app works without internet access.

## Project Structure

```
Smart-Voice-Generator/
├── app.py                 # Entry point: python app.py
├── requirements.txt       # Flask only
├── README.md
├── database.db            # Created automatically on first run
├── backend/
│   ├── __init__.py        # App factory, page routes, error handlers, security headers
│   ├── database.py        # SQLite connection and queries (parameterized)
│   ├── models.py          # Validation and text analysis
│   └── routes.py          # REST API endpoints
├── frontend/
│   ├── index.html         # Home / dashboard
│   ├── history.html
│   ├── about.html
│   ├── css/  style.css, responsive.css, animations.css
│   └── js/   main.js, analysis.js, speech.js, history.js
└── static/audio/          # Reserved for server-generated audio (not used yet)
```

## Installation

You need **Python 3.9 or newer**. In VS Code, open the `Smart-Voice-Generator` folder (File > Open Folder), then open the integrated terminal (Terminal > New Terminal).

Create a virtual environment:

```bash
python -m venv venv
```

Activate it.

Windows (Command Prompt or the VS Code terminal):

```bash
venv\Scripts\activate
```

Windows PowerShell, if scripts are blocked, run this once first: `Set-ExecutionPolicy -Scope Process RemoteSigned`

macOS / Linux:

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run:

```bash
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

Press `Ctrl+C` in the terminal to stop the server. If VS Code asks which Python interpreter to use, choose the one inside `venv`.

If port 5000 is already in use (common on macOS), change the `port=5000` value at the bottom of `app.py` and open that port instead.

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Server and database status |
| POST | `/api/analyze` | Text statistics. Body: `{"text": "...", "rate": 1.0}` |
| POST | `/api/history` | Save a request. Body: `text`, `language`, `voice`, `rate`, `pitch`, `volume` (percent) |
| GET | `/api/history` | List requests, newest first (`limit`, `offset`) |
| DELETE | `/api/history/<id>` | Delete one request |
| DELETE | `/api/history` | Delete all requests |
| GET | `/api/stats` | Dashboard summary numbers |

All responses are JSON. Errors look like `{"error": {"code": "...", "message": "..."}}`.

## How It Works

Text Input
→ Text Analysis
→ Voice Selection
→ Speech Configuration
→ Speech Synthesis
→ History Storage

1. **Text Input** – you type or paste text (maximum 5,000 characters).
2. **Text Analysis** – `analysis.js` recalculates the statistics on every keystroke.
3. **Voice Selection** – the language and voice lists are built from `speechSynthesis.getVoices()`, so only voices on your device appear.
4. **Speech Configuration** – speed, pitch and volume sliders (defaults come from Settings).
5. **Speech Synthesis** – `speech.js` splits the text into sentences and speaks them one by one. This avoids a Chrome problem where long utterances stop after roughly 15 seconds, and lets slider changes apply from the next sentence.
6. **History Storage** – when you press Play, the request is sent to `POST /api/history` and stored in SQLite. Previewing a voice is not stored.

## Browser Compatibility

Speech synthesis is provided by the browser and the operating system, so **which voices and languages are available depends on your browser and device**. Tamil, Hindi, Telugu, Malayalam and Kannada voices appear only if your system provides them (on Windows, add them under Settings > Time & language > Speech; on Android and iOS, install them in the system text-to-speech settings). Some browsers load voices a moment after the page opens. Some mobile browsers do not support Pause and Resume.

**Audio download:** the Web Speech API plays sound directly and does not give the page an audio file. For that reason the **Download Audio** button explains the limitation and does not create a file. The `static/audio/` folder and `/audio/<file>` route are ready if a server-side speech engine is added later.

Tested design target: current versions of Chrome, Edge, Safari and Firefox.

## Security Notes

- All SQL uses parameterized queries.
- The server validates text length, language code, voice name and the speech numbers, and rejects malformed JSON.
- User text is displayed with `textContent`, never inserted as HTML.
- A strict Content-Security-Policy allows only scripts and styles served by the app itself.
- The server binds to `127.0.0.1` only. Debug mode is intended for local use; set the environment variable `SVG_DEBUG=0` to turn it off.
- Only the text you speak and the voice settings are stored. No names, accounts or device data are collected.

## Future Enhancements

- Cloud TTS integration
- More natural AI voices
- Audio file generation
- Multi-language support
- Voice cloning with appropriate safeguards
- Advanced pronunciation controls
