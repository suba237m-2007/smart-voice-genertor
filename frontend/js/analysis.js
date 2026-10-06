/* ==========================================================================
   analysis.js - text editor behaviour and client-side text analysis
   The counting rules match backend/models.py (analyze_text).
   ========================================================================== */
(function () {
  'use strict';

  var SV = (window.SV = window.SV || {});

  var MAX_LENGTH = 5000; // Keep in sync with MAX_TEXT_LENGTH in backend/models.py
  var READING_WPM = 200;
  var SPEAKING_WPM = 150; // at a speech rate of 1.0x

  var HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
  // A sentence ends at . ! ? an ellipsis character or the Devanagari danda.
  var SENTENCE_PATTERN = /[^.!?\u0964\u2026]+[.!?\u0964\u2026]*/g;

  function roundSeconds(words, wordsPerMinute, speed) {
    if (words === 0) return 0;
    return Math.max(1, Math.round((words / (wordsPerMinute * speed)) * 60));
  }

  /** Analyse text and return the statistics shown on the home page. */
  function analyze(text, rate) {
    var speed = rate > 0 ? rate : 1;
    var words = text.split(/\s+/).filter(function (token) { return HAS_LETTER_OR_DIGIT.test(token); });
    var sentences = (text.match(SENTENCE_PATTERN) || []).filter(function (part) {
      return HAS_LETTER_OR_DIGIT.test(part);
    });
    var paragraphs = text.split(/\n\s*\n/).filter(function (block) { return block.trim() !== ''; });
    var wordCount = words.length;
    var sentenceCount = sentences.length;

    return {
      characters: text.length,
      charactersNoSpaces: text.replace(/\s/g, '').length,
      words: wordCount,
      sentences: sentenceCount,
      paragraphs: paragraphs.length,
      avgWordsPerSentence: sentenceCount ? Math.round((wordCount / sentenceCount) * 10) / 10 : 0,
      readingSeconds: roundSeconds(wordCount, READING_WPM, 1),
      speakingSeconds: roundSeconds(wordCount, SPEAKING_WPM, speed)
    };
  }

  SV.analysis = { analyze: analyze, MAX_LENGTH: MAX_LENGTH };

  // Allow the file to be loaded by Node for testing without a browser.
  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    var textarea = document.getElementById('textInput');
    if (!textarea) return; // Not the home page.

    var rateInput = document.getElementById('rate');
    var errorBox = document.getElementById('inputError');
    var format = SV.util;

    function setText(id, value) {
      document.getElementById(id).textContent = value;
    }

    /** Recalculate and display every statistic. */
    function update() {
      var rate = rateInput ? parseFloat(rateInput.value) : 1;
      var stats = analyze(textarea.value, rate);

      setText('liveChars', format.formatNumber(stats.characters));
      setText('liveWords', format.formatNumber(stats.words));
      setText('liveSentences', format.formatNumber(stats.sentences));

      var remaining = MAX_LENGTH - stats.characters;
      var remainingEl = document.getElementById('charsRemaining');
      remainingEl.textContent = format.formatNumber(remaining) + (remaining === 1 ? ' character remaining' : ' characters remaining');
      remainingEl.classList.toggle('is-low', remaining <= MAX_LENGTH * 0.1);

      setText('statWords', format.formatNumber(stats.words));
      setText('statChars', format.formatNumber(stats.characters));
      setText('statCharsNoSpaces', format.formatNumber(stats.charactersNoSpaces));
      setText('statSentences', format.formatNumber(stats.sentences));
      setText('statParagraphs', format.formatNumber(stats.paragraphs));
      setText('statAverage', String(stats.avgWordsPerSentence));
      setText('statReading', format.formatDuration(stats.readingSeconds));
      setText('statSpeech', format.formatDuration(stats.speakingSeconds));
    }

    function clearError() {
      errorBox.hidden = true;
      errorBox.textContent = '';
      textarea.removeAttribute('aria-invalid');
    }

    /** Show a validation message under the text box and move focus into it. */
    SV.showInputError = function (message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      textarea.setAttribute('aria-invalid', 'true');
      textarea.focus();
    };

    textarea.addEventListener('input', function () {
      update();
      if (textarea.value.trim()) clearError();
    });
    if (rateInput) rateInput.addEventListener('input', update);

    /* ----- Buttons ----- */
    document.getElementById('clearBtn').addEventListener('click', function () {
      if (!textarea.value) {
        SV.toast('The text box is already empty.', 'info');
        return;
      }
      textarea.value = '';
      update();
      clearError();
      textarea.focus();
      SV.toast('Text cleared.', 'success');
    });

    document.getElementById('copyBtn').addEventListener('click', function () {
      var text = textarea.value;
      if (!text) {
        SV.toast('There is no text to copy.', 'warning');
        return;
      }
      var done = function () { SV.toast('Text copied to the clipboard.', 'success'); };
      var fallback = function () {
        // Older browsers: select the text and use the legacy command.
        textarea.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
        textarea.setSelectionRange(text.length, text.length);
        if (copied) done();
        else SV.toast('Copying is blocked by your browser. Select the text and press Ctrl+C.', 'error');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });

    document.getElementById('pasteBtn').addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        SV.toast('Your browser does not allow pasting from a button. Click in the text box and press Ctrl+V.', 'warning');
        return;
      }
      navigator.clipboard.readText().then(
        function (clip) {
          if (!clip) {
            SV.toast('The clipboard is empty.', 'warning');
            return;
          }
          var start = textarea.selectionStart;
          var end = textarea.selectionEnd;
          var room = MAX_LENGTH - (textarea.value.length - (end - start));
          var insert = clip.slice(0, Math.max(room, 0));
          textarea.setRangeText(insert, start, end, 'end');
          update();
          textarea.focus();
          if (insert.length < clip.length) {
            SV.toast('Pasted text was shortened to fit the ' + format.formatNumber(MAX_LENGTH) + ' character limit.', 'warning');
          } else {
            SV.toast('Text pasted.', 'success');
          }
        },
        function () {
          SV.toast('Pasting was blocked. Allow clipboard access, or click in the text box and press Ctrl+V.', 'error');
        }
      );
    });

    // "Start Speaking" jumps to the editor and focuses the text box.
    document.getElementById('startBtn').addEventListener('click', function (event) {
      event.preventDefault();
      document.getElementById('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      textarea.focus({ preventScroll: true });
    });

    update();
  });
})();
