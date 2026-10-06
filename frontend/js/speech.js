/* ==========================================================================
   speech.js - speech synthesis engine and controls (Web Speech API)
   Long text is split into sentence chunks that are spoken one after the
   other. This avoids a Chrome problem where long utterances stop after
   about 15 seconds, and lets speed, pitch and volume changes apply from the
   next chunk.
   ========================================================================== */
(function () {
  'use strict';

  var SV = (window.SV = window.SV || {});

  var CHUNK_LENGTH = 180;
  var REUSE_KEY = 'sv.reuse';

  var PREVIEW_SENTENCES = {
    en: 'Hello! Welcome to Smart Voice Generator.',
    ta: '\u0bb5\u0ba3\u0b95\u0bcd\u0b95\u0bae\u0bcd! \u0bb8\u0bcd\u0bae\u0bbe\u0bb0\u0bcd\u0b9f\u0bcd \u0bb5\u0bbe\u0baf\u0bcd\u0bb8\u0bcd \u0b9c\u0bc6\u0ba9\u0bb0\u0bc7\u0b9f\u0bcd\u0b9f\u0bb0\u0bc1\u0b95\u0bcd\u0b95\u0bc1 \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bc8 \u0bb5\u0bb0\u0bb5\u0bc7\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bcb\u0bae\u0bcd.',
    hi: '\u0928\u092e\u0938\u094d\u0924\u0947! \u0938\u094d\u092e\u093e\u0930\u094d\u091f \u0935\u0949\u0907\u0938 \u091c\u0947\u0928\u0930\u0947\u091f\u0930 \u092e\u0947\u0902 \u0906\u092a\u0915\u093e \u0938\u094d\u0935\u093e\u0917\u0924 \u0939\u0948\u0964',
    te: '\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02! \u0c38\u0c4d\u0c2e\u0c3e\u0c30\u0c4d\u0c1f\u0c4d \u0c35\u0c3e\u0c2f\u0c3f\u0c38\u0c4d \u0c1c\u0c28\u0c30\u0c47\u0c1f\u0c30\u0c4d\u200c\u0c15\u0c41 \u0c38\u0c4d\u0c35\u0c3e\u0c17\u0c24\u0c02.',
    ml: '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02! \u0d38\u0d4d\u0d2e\u0d3e\u0d7c\u0d1f\u0d4d\u0d1f\u0d4d \u0d35\u0d4b\u0d2f\u0d4d\u0d38\u0d4d \u0d1c\u0d28\u0d31\u0d47\u0d31\u0d4d\u0d31\u0d31\u0d3f\u0d32\u0d47\u0d15\u0d4d\u0d15\u0d4d \u0d38\u0d4d\u0d35\u0d3e\u0d17\u0d24\u0d02.',
    kn: '\u0ca8\u0cae\u0cb8\u0ccd\u0c95\u0cbe\u0cb0! \u0cb8\u0ccd\u0cae\u0cbe\u0cb0\u0ccd\u0c9f\u0ccd \u0cb5\u0cbe\u0caf\u0ccd\u0cb8\u0ccd \u0c9c\u0ca8\u0cb0\u0cc7\u0c9f\u0cb0\u0ccd\u200c\u0c97\u0cc6 \u0cb8\u0ccd\u0cb5\u0cbe\u0c97\u0ca4.'
  };

  /* ---------- Text chunking ---------- */
  function hardSplit(piece, limit) {
    var parts = [];
    var rest = piece.trim();
    while (rest.length > limit) {
      var cut = rest.lastIndexOf(' ', limit);
      if (cut <= 0) cut = limit;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  /** Split text into short, speakable chunks without crossing line breaks. */
  function splitIntoChunks(text, limit) {
    var chunks = [];
    text.split(/\n+/).forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      var sentences = trimmed.match(/[^.!?\u0964\u2026]+[.!?\u0964\u2026]*\s*/g) || [trimmed];
      var current = '';
      sentences.forEach(function (sentence) {
        if ((current + sentence).length <= limit) {
          current += sentence;
          return;
        }
        if (current.trim()) chunks.push(current.trim());
        current = '';
        if (sentence.length > limit) hardSplit(sentence, limit).forEach(function (p) { chunks.push(p); });
        else current = sentence;
      });
      if (current.trim()) chunks.push(current.trim());
    });
    return chunks.filter(function (chunk) { return /[\p{L}\p{N}]/u.test(chunk); });
  }

  SV.splitIntoChunks = splitIntoChunks;
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    var textarea = document.getElementById('textInput');
    if (!textarea || !document.getElementById('playBtn')) return;

    var $ = function (id) { return document.getElementById(id); };
    var languageSelect = $('languageSelect');
    var voiceSelect = $('voiceSelect');
    var rateInput = $('rate');
    var pitchInput = $('pitch');
    var volumeInput = $('volume');
    var playBtn = $('playBtn');
    var pauseBtn = $('pauseBtn');
    var resumeBtn = $('resumeBtn');
    var stopBtn = $('stopBtn');
    var previewBtn = $('previewBtn');
    var downloadBtn = $('downloadBtn');
    var statusBox = $('speechStatus');
    var statusText = $('statusText');
    var progress = $('speechProgress');
    var notice = $('voiceNotice');
    var synth = SV.voices.supported ? window.speechSynthesis : null;

    var allVoices = [];
    var state = 'idle'; // idle | speaking | paused
    var session = 0;   // Incremented whenever speech is started or cancelled.
    var queue = [];
    var queueIndex = 0;
    var currentUtterance = null; // Held in a variable so it is not garbage collected mid-speech.
    var settings = SV.settings.load();
    var preferred = { language: settings.language !== 'auto' ? settings.language : null, voiceName: null };

    /* ---------- Sliders ---------- */
    function updateOutputs() {
      $('rateValue').textContent = parseFloat(rateInput.value).toFixed(1) + 'x';
      $('pitchValue').textContent = parseFloat(pitchInput.value).toFixed(1);
      $('volumeValue').textContent = volumeInput.value + '%';
    }
    function setRange(input, value) {
      var number = parseFloat(value);
      if (isNaN(number)) return;
      input.value = Math.min(Math.max(number, parseFloat(input.min)), parseFloat(input.max));
      input.dispatchEvent(new Event('input')); // Lets analysis.js refresh the speech-time estimate.
    }
    [rateInput, pitchInput, volumeInput].forEach(function (input) {
      input.addEventListener('input', updateOutputs);
    });
    setRange(rateInput, settings.rate);
    setRange(pitchInput, settings.pitch);
    setRange(volumeInput, settings.volume);

    /* ---------- Status and buttons ---------- */
    function setState(next, message) {
      state = next;
      statusBox.setAttribute('data-state', next);
      var defaults = { idle: 'Ready', speaking: 'Speaking...', paused: 'Paused' };
      statusText.textContent = message || defaults[next];
      var usable = !!synth;
      playBtn.disabled = !usable || next !== 'idle';
      pauseBtn.disabled = !usable || next !== 'speaking';
      resumeBtn.disabled = !usable || next !== 'paused';
      stopBtn.disabled = !usable || next === 'idle';
      previewBtn.disabled = !usable;
    }

    function showNotice(message) {
      notice.textContent = message;
      notice.hidden = false;
    }

    /* ---------- Voices and languages ---------- */
    function populateLanguages() {
      var languages = SV.voices.languages();
      var previous = languageSelect.value;
      languageSelect.textContent = '';

      if (!languages.length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = 'No voices available';
        languageSelect.appendChild(none);
        return;
      }
      languages.forEach(function (language) {
        var option = document.createElement('option');
        option.value = language.code;
        option.textContent = language.label + ' (' + language.code + ')';
        languageSelect.appendChild(option);
      });

      var codes = languages.map(function (language) { return language.code; });
      var choice = codes.indexOf(previous) !== -1 ? previous : null;
      [preferred.language, navigator.language, 'en'].forEach(function (wanted) {
        if (!choice) choice = SV.voices.match(wanted, codes);
      });
      languageSelect.value = choice || codes[0];
    }

    function populateVoices() {
      var language = languageSelect.value;
      var previous = voiceSelect.value;
      voiceSelect.textContent = '';

      var matching = allVoices
        .filter(function (voice) { return SV.voices.normalize(voice.lang) === language; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });

      if (!matching.length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = 'No voices available';
        voiceSelect.appendChild(none);
        return;
      }
      matching.forEach(function (voice) {
        var option = document.createElement('option');
        option.value = voice.voiceURI;
        option.textContent = voice.name + (voice.localService ? '' : ' (online)');
        voiceSelect.appendChild(option);
      });

      var uris = matching.map(function (voice) { return voice.voiceURI; });
      var byName = matching.filter(function (voice) { return voice.name === preferred.voiceName; })[0];
      var byDefault = matching.filter(function (voice) { return voice.default; })[0];
      var choice = uris.indexOf(previous) !== -1 ? previous
        : byName ? byName.voiceURI
        : byDefault ? byDefault.voiceURI
        : uris[0];
      voiceSelect.value = choice;

      // The saved defaults and any "Use Again" request have now been applied.
      preferred = { language: null, voiceName: null };
    }

    function selectedVoice() {
      return allVoices.filter(function (voice) { return voice.voiceURI === voiceSelect.value; })[0] || null;
    }

    function refreshVoices() {
      allVoices = SV.voices.list();
      populateLanguages();
      populateVoices();
      if (allVoices.length) notice.hidden = true;
    }

    languageSelect.addEventListener('change', populateVoices);

    /* ---------- Speaking ---------- */
    function describeError(code) {
      var messages = {
        'not-allowed': 'The browser blocked speech. Click Play again to allow it.',
        'synthesis-unavailable': 'Speech synthesis is not available right now. Try another voice.',
        'synthesis-failed': 'The selected voice could not speak this text. Try another voice.',
        'language-unavailable': 'The selected language is not available on this device.',
        'voice-unavailable': 'The selected voice is not available. Choose another voice.',
        'text-too-long': 'The text is too long for this voice. Try a shorter passage.',
        'invalid-argument': 'One of the speech settings was not accepted. Reset the sliders and try again.'
      };
      return messages[code] || 'Speech failed unexpectedly (' + (code || 'unknown error') + ').';
    }

    function buildUtterance(text) {
      var utterance = new SpeechSynthesisUtterance(text);
      var voice = selectedVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (languageSelect.value) {
        utterance.lang = languageSelect.value;
      }
      // Read the sliders now so changes apply from the next chunk.
      utterance.rate = parseFloat(rateInput.value);
      utterance.pitch = parseFloat(pitchInput.value);
      utterance.volume = parseInt(volumeInput.value, 10) / 100;
      return utterance;
    }

    function cancelSpeech() {
      session += 1; // Makes callbacks from the old session do nothing.
      queue = [];
      queueIndex = 0;
      currentUtterance = null;
      if (synth) {
        synth.cancel();
        synth.resume(); // Some browsers stay paused after cancel().
      }
    }

    function updateProgress() {
      progress.value = queue.length ? Math.round((queueIndex / queue.length) * 100) : 0;
    }

    function speakNext(mySession) {
      if (mySession !== session) return;
      if (queueIndex >= queue.length) {
        progress.value = 100;
        currentUtterance = null;
        setState('idle', 'Finished speaking');
        return;
      }
      var utterance = buildUtterance(queue[queueIndex]);
      utterance.onend = function () {
        if (mySession !== session) return;
        queueIndex += 1;
        updateProgress();
        speakNext(mySession);
      };
      utterance.onerror = function (event) {
        if (mySession !== session) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        cancelSpeech();
        setState('idle', 'Speech stopped');
        SV.toast(describeError(event.error), 'error');
      };
      currentUtterance = utterance;
      synth.speak(utterance);
    }

    function startSpeaking(chunks, label) {
      cancelSpeech();
      var mySession = session;
      queue = chunks;
      queueIndex = 0;
      progress.value = 0;
      setState('speaking', label);
      // A short delay avoids a Chrome bug where speak() right after cancel() is ignored.
      window.setTimeout(function () { speakNext(mySession); }, 80);
    }

    function recordHistory(text) {
      var voice = selectedVoice();
      var payload = {
        text: text,
        language: languageSelect.value || (voice && SV.voices.normalize(voice.lang)) || 'en-US',
        voice: voice ? voice.name : 'Browser default',
        rate: parseFloat(rateInput.value),
        pitch: parseFloat(pitchInput.value),
        volume: parseInt(volumeInput.value, 10)
      };
      SV.api('/api/history', { method: 'POST', body: payload }).then(
        function () { document.dispatchEvent(new CustomEvent('sv:history-changed')); },
        function (error) {
          SV.toast('Speech started, but it could not be saved to history. ' + error.message, 'warning');
        }
      );
    }

    function onPlay() {
      if (!synth) return;
      var text = textarea.value.trim();
      if (!text) {
        SV.showInputError('Please enter some text before generating speech.');
        return;
      }
      if (text.length > SV.analysis.MAX_LENGTH) {
        SV.showInputError('Your text is too long. The limit is ' + SV.util.formatNumber(SV.analysis.MAX_LENGTH) + ' characters.');
        return;
      }
      var chunks = splitIntoChunks(text, CHUNK_LENGTH);
      if (!chunks.length) {
        SV.showInputError('The text has no words that can be spoken. Add some letters or numbers.');
        return;
      }
      startSpeaking(chunks);
      recordHistory(text);
    }

    function onPreview() {
      if (!synth) return;
      var voice = selectedVoice();
      var code = voice ? voice.lang : languageSelect.value;
      var base = SV.voices.normalize(code).split('-')[0].toLowerCase();
      startSpeaking([PREVIEW_SENTENCES[base] || PREVIEW_SENTENCES.en], 'Previewing voice...');
    }

    playBtn.addEventListener('click', onPlay);
    previewBtn.addEventListener('click', onPreview);
    pauseBtn.addEventListener('click', function () {
      if (state !== 'speaking') return;
      synth.pause();
      setState('paused');
    });
    resumeBtn.addEventListener('click', function () {
      if (state !== 'paused') return;
      synth.resume();
      setState('speaking');
    });
    stopBtn.addEventListener('click', function () {
      cancelSpeech();
      progress.value = 0;
      setState('idle', 'Stopped');
    });

    textarea.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && state === 'idle') {
        event.preventDefault();
        onPlay();
      }
    });

    // Honest explanation: browser speech cannot be exported as an audio file.
    downloadBtn.addEventListener('click', function () {
      SV.confirm({
        title: 'Audio download is not available',
        message: 'The Web Speech API plays speech through your device but does not hand the audio to web pages, so no audio file can be created from browser voices. No file was generated. A server-side speech engine could provide downloads in a future version, with files stored in static/audio/.',
        confirmText: 'Got it',
        cancelText: null
      });
    });

    // Stop speech when leaving the page; some browsers keep speaking otherwise.
    window.addEventListener('pagehide', function () { if (synth) synth.cancel(); });

    /* ---------- "Use Again" from the History page ---------- */
    function applyReuseRequest() {
      var raw;
      try {
        raw = sessionStorage.getItem(REUSE_KEY);
        sessionStorage.removeItem(REUSE_KEY);
      } catch (error) {
        return;
      }
      if (!raw) return;
      try {
        var item = JSON.parse(raw);
        if (typeof item.text !== 'string') return;
        textarea.value = item.text.slice(0, SV.analysis.MAX_LENGTH);
        setRange(rateInput, item.rate);
        setRange(pitchInput, item.pitch);
        setRange(volumeInput, item.volume);
        preferred = { language: item.language || null, voiceName: item.voice || null };
        textarea.dispatchEvent(new Event('input'));
        SV.toast('Text and voice settings loaded from history. Press Play to speak.', 'success');
      } catch (error) {
        SV.toast('That history item could not be loaded.', 'error');
      }
    }

    /* ---------- Settings changed in the Settings dialog ---------- */
    document.addEventListener('sv:settings-changed', function (event) {
      var updated = event.detail;
      setRange(rateInput, updated.rate);
      setRange(pitchInput, updated.pitch);
      setRange(volumeInput, updated.volume);
      if (updated.language !== 'auto') {
        var codes = Array.prototype.map.call(languageSelect.options, function (option) { return option.value; });
        var match = SV.voices.match(updated.language, codes);
        if (match) {
          languageSelect.value = match;
          populateVoices();
        }
      }
    });

    /* ---------- Start-up ---------- */
    setState('idle');

    if (!synth) {
      showNotice('This browser does not support speech synthesis. Open the app in a current version of Chrome, Edge, Safari or Firefox.');
      languageSelect.disabled = true;
      voiceSelect.disabled = true;
      [languageSelect, voiceSelect].forEach(function (select) {
        select.textContent = '';
        var option = document.createElement('option');
        option.textContent = 'Speech not supported';
        select.appendChild(option);
      });
      applyReuseRequest();
      return;
    }

    applyReuseRequest();
    refreshVoices();
    synth.addEventListener('voiceschanged', refreshVoices);
    // Some browsers fill the voice list late and never fire voiceschanged.
    window.setTimeout(function () { if (!allVoices.length) refreshVoices(); }, 1500);
    window.setTimeout(function () {
      if (!SV.voices.list().length) {
        showNotice('No speech voices were found on this device. Install a text-to-speech voice in your system settings, or try another browser. Play will still try the default voice.');
      }
    }, 3500);
  });
})();
