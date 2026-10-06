/* ==========================================================================
   main.js - code shared by every page
   Theme, settings, navigation, toasts, dialogs, API helper, voice helpers
   and the dashboard summary. Loaded in the <head> so the saved theme is
   applied before the page is painted (no flash of the wrong theme).
   All user-supplied text is inserted with textContent, never innerHTML.
   ========================================================================== */
(function () {
  'use strict';

  var SV = (window.SV = window.SV || {});

  /* ---------- Settings (localStorage) ---------- */
  var STORAGE_KEY = 'svg.settings';
  var DEFAULT_SETTINGS = { language: 'auto', rate: 1, pitch: 1, volume: 100, theme: null };

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return Object.assign({}, DEFAULT_SETTINGS, saved && typeof saved === 'object' ? saved : {});
    } catch (error) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      return false; // Storage can be blocked (private mode, strict settings).
    }
  }

  SV.settings = { load: loadSettings, save: saveSettings, defaults: DEFAULT_SETTINGS };

  /* ---------- Theme ---------- */
  function currentTheme(settings) {
    if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('[data-theme-set]');
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-theme-set') === theme));
    });
  }

  applyTheme(currentTheme(loadSettings())); // Runs immediately, before first paint.

  /* ---------- Small helpers ---------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var idCounter = 0;
  function uniqueId(prefix) {
    idCounter += 1;
    return prefix + '-' + idCounter;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString();
  }

  function formatDuration(totalSeconds) {
    var seconds = Math.max(0, Math.round(totalSeconds));
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
  }

  // Dates are stored in UTC by the server and shown in the viewer's time zone.
  function parseDate(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(iso) {
    var date = parseDate(iso);
    if (!date) return 'Unknown date';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function relativeTime(iso) {
    var date = parseDate(iso);
    if (!date) return 'No activity yet';
    var seconds = Math.round((date.getTime() - Date.now()) / 1000);
    var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    var formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(seconds) >= units[i][1]) {
        return formatter.format(Math.round(seconds / units[i][1]), units[i][0]);
      }
    }
    return 'just now';
  }

  SV.util = {
    el: el,
    formatNumber: formatNumber,
    formatDuration: formatDuration,
    formatDateTime: formatDateTime,
    relativeTime: relativeTime
  };

  /* ---------- Toast notifications ---------- */
  SV.toast = function (message, type, duration) {
    var region = document.getElementById('toastRegion');
    if (!region) return;
    var toast = el('div', 'toast toast-' + (type || 'info'));
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.appendChild(el('span', 'toast-message', message));

    var close = el('button', 'toast-close', '\u00d7');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');

    function remove() {
      toast.classList.add('is-leaving');
      window.setTimeout(function () { toast.remove(); }, 200);
    }
    close.addEventListener('click', remove);
    toast.appendChild(close);
    region.appendChild(toast);

    // Keep at most four toasts on screen.
    while (region.children.length > 4) region.firstChild.remove();
    window.setTimeout(remove, duration || (type === 'error' ? 7000 : 4000));
  };

  /* ---------- Dialogs ---------- */
  // Returns a Promise<boolean>. Pass cancelText: null for an information-only dialog.
  SV.confirm = function (options) {
    return new Promise(function (resolve) {
      if (typeof HTMLDialogElement === 'undefined') {
        resolve(window.confirm(options.title + '\n\n' + options.message));
        return;
      }
      var dialog = el('dialog', 'dialog');
      var titleId = uniqueId('dialog-title');
      dialog.setAttribute('aria-labelledby', titleId);
      var title = el('h2', '', options.title);
      title.id = titleId;
      var actions = el('div', 'dialog-actions');
      var confirmed = false;

      if (options.cancelText !== null) {
        var cancel = el('button', 'btn btn-secondary', options.cancelText || 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { dialog.close(); });
        actions.appendChild(cancel);
      }
      var ok = el('button', 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary'), options.confirmText || 'OK');
      ok.type = 'button';
      ok.addEventListener('click', function () { confirmed = true; dialog.close(); });
      actions.appendChild(ok);

      dialog.append(title, el('p', '', options.message), actions);
      dialog.addEventListener('close', function () { dialog.remove(); resolve(confirmed); });
      document.body.appendChild(dialog);
      dialog.showModal();
      (cancel || ok).focus();
    });
  };

  /* ---------- API helper ---------- */
  function ApiError(message, status) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status;
  }
  ApiError.prototype = Object.create(Error.prototype);

  SV.api = function (path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', headers: {} };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(
      function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var message = data && data.error && data.error.message;
            throw new ApiError(message || 'The request failed (status ' + response.status + ').', response.status);
          }
          return data;
        });
      },
      function () {
        throw new ApiError('Could not reach the server. Check that "python app.py" is still running.', 0);
      }
    );
  };

  /* ---------- Voice helpers ---------- */
  var synthesisSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function normalizeLang(code) {
    return String(code || '').replace('_', '-');
  }

  // Intl.DisplayNames throws for a malformed navigator.language, so fall back to English names.
  var displayNames = null;
  function getDisplayNames() {
    if (displayNames) return displayNames;
    var candidates = [navigator.language, 'en'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        displayNames = new Intl.DisplayNames([candidates[i]], { type: 'language' });
        return displayNames;
      } catch (error) { /* try the next candidate */ }
    }
    return null;
  }

  function languageLabel(code) {
    var normalized = normalizeLang(code);
    try {
      var names = getDisplayNames();
      return (names && names.of(normalized)) || normalized;
    } catch (error) {
      return normalized;
    }
  }

  function listVoices() {
    return synthesisSupported ? window.speechSynthesis.getVoices() : [];
  }

  function listLanguages() {
    var seen = {};
    listVoices().forEach(function (voice) {
      var code = normalizeLang(voice.lang);
      if (code) seen[code] = true;
    });
    return Object.keys(seen)
      .map(function (code) { return { code: code, label: languageLabel(code) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  // Find the entry of `codes` that best matches `wanted` (exact, then same base language).
  function matchLanguage(wanted, codes) {
    if (!wanted) return null;
    var target = normalizeLang(wanted).toLowerCase();
    var exact = codes.filter(function (code) { return code.toLowerCase() === target; })[0];
    if (exact) return exact;
    var base = target.split('-')[0];
    return codes.filter(function (code) { return code.toLowerCase().split('-')[0] === base; })[0] || null;
  }

  SV.voices = {
    supported: synthesisSupported,
    list: listVoices,
    languages: listLanguages,
    languageLabel: languageLabel,
    normalize: normalizeLang,
    match: matchLanguage
  };

  /* ---------- Settings dialog ---------- */
  function openSettings() {
    if (typeof HTMLDialogElement === 'undefined') {
      SV.toast('Your browser is too old to show the settings panel.', 'error');
      return;
    }
    var settings = loadSettings();
    var dialog = el('dialog', 'dialog');
    dialog.setAttribute('aria-labelledby', 'settingsTitle');

    var title = el('h2', '', 'Settings');
    title.id = 'settingsTitle';
    dialog.appendChild(title);
    dialog.appendChild(el('p', 'hint', 'Defaults are saved in this browser and used whenever the home page opens.'));

    // Default language
    var langField = el('div', 'field');
    var langLabel = el('label', '', 'Default language');
    langLabel.setAttribute('for', 'setLanguage');
    var langSelect = el('select');
    langSelect.id = 'setLanguage';
    var auto = el('option', '', 'Automatic (browser language)');
    auto.value = 'auto';
    langSelect.appendChild(auto);
    var languages = listLanguages();
    if (settings.language !== 'auto' && !languages.some(function (l) { return l.code === settings.language; })) {
      languages.push({ code: settings.language, label: languageLabel(settings.language) });
    }
    languages.forEach(function (language) {
      var option = el('option', '', language.label);
      option.value = language.code;
      langSelect.appendChild(option);
    });
    langSelect.value = settings.language;
    langField.append(langLabel, langSelect);
    dialog.appendChild(langField);

    // Sliders
    function sliderField(id, label, min, max, step, value, format) {
      var field = el('div', 'field');
      var row = el('div', 'field-row');
      var lab = el('label', '', label);
      lab.setAttribute('for', id);
      var out = el('output', '', format(value));
      out.setAttribute('for', id);
      row.append(lab, out);
      var input = el('input');
      input.type = 'range';
      input.id = id;
      input.min = min; input.max = max; input.step = step; input.value = value;
      input.addEventListener('input', function () { out.textContent = format(input.value); });
      field.append(row, input);
      dialog.appendChild(field);
      return input;
    }
    var rateInput = sliderField('setRate', 'Default speech rate', 0.5, 2, 0.1, settings.rate, function (v) { return Number(v).toFixed(1) + 'x'; });
    var pitchInput = sliderField('setPitch', 'Default pitch', 0, 2, 0.1, settings.pitch, function (v) { return Number(v).toFixed(1); });
    var volumeInput = sliderField('setVolume', 'Default volume', 0, 100, 5, settings.volume, function (v) { return v + '%'; });

    // Dark mode
    var switchRow = el('div', 'switch-row');
    var darkBox = el('input');
    darkBox.type = 'checkbox';
    darkBox.id = 'setDark';
    darkBox.checked = document.documentElement.getAttribute('data-theme') === 'dark';
    var darkLabel = el('label', '', 'Dark mode');
    darkLabel.setAttribute('for', 'setDark');
    switchRow.append(darkBox, darkLabel);
    dialog.appendChild(switchRow);

    // Clear history
    var danger = el('div', 'dialog-section');
    danger.appendChild(el('p', 'hint', 'Remove every saved speech request from the database.'));
    var clearBtn = el('button', 'btn btn-danger btn-sm', 'Clear history');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () { SV.clearHistory(); });
    danger.appendChild(clearBtn);
    dialog.appendChild(danger);

    // Buttons
    var actions = el('div', 'dialog-actions');
    var closeBtn = el('button', 'btn btn-secondary', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () { dialog.close(); });
    var saveBtn = el('button', 'btn btn-primary', 'Save settings');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', function () {
      var updated = {
        language: langSelect.value,
        rate: parseFloat(rateInput.value),
        pitch: parseFloat(pitchInput.value),
        volume: parseInt(volumeInput.value, 10),
        theme: darkBox.checked ? 'dark' : 'light'
      };
      if (!saveSettings(updated)) {
        SV.toast('Settings could not be saved because browser storage is blocked.', 'error');
        return;
      }
      applyTheme(updated.theme);
      document.dispatchEvent(new CustomEvent('sv:settings-changed', { detail: updated }));
      SV.toast('Settings saved.', 'success');
      dialog.close();
    });
    actions.append(closeBtn, saveBtn);
    dialog.appendChild(actions);

    dialog.addEventListener('close', function () { dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    langSelect.focus();
  }

  /* ---------- Shared history actions ---------- */
  // Used by the settings dialog and the History page.
  SV.clearHistory = function () {
    return SV.confirm({
      title: 'Clear all history?',
      message: 'This permanently deletes every saved speech request. This cannot be undone.',
      confirmText: 'Clear History',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return false;
      return SV.api('/api/history', { method: 'DELETE' }).then(
        function (result) {
          SV.toast(result.deleted ? 'History cleared.' : 'History was already empty.', 'success');
          document.dispatchEvent(new CustomEvent('sv:history-changed'));
          return true;
        },
        function (error) {
          SV.toast('History could not be cleared. ' + error.message, 'error');
          return false;
        }
      );
    });
  };

  /* ---------- Dashboard summary (home page) ---------- */
  function loadSummary() {
    var region = document.getElementById('summaryRegion');
    if (!region) return;
    var note = document.getElementById('summaryNote');
    SV.api('/api/stats').then(
      function (stats) {
        document.getElementById('sumRequests').textContent = formatNumber(stats.total_requests);
        document.getElementById('sumWords').textContent = formatNumber(stats.total_words);
        document.getElementById('sumLanguage').textContent = stats.most_used_language
          ? languageLabel(stats.most_used_language) : 'None yet';
        document.getElementById('sumRecent').textContent = stats.recent_activity
          ? relativeTime(stats.recent_activity) : 'None yet';
        if (note) note.hidden = true;
      },
      function (error) {
        ['sumRequests', 'sumWords', 'sumLanguage', 'sumRecent'].forEach(function (id) {
          document.getElementById(id).textContent = '\u2013';
        });
        if (note) {
          note.textContent = 'The activity summary is unavailable. ' + error.message;
          note.hidden = false;
        }
      }
    );
  }

  /* ---------- Page wiring ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(currentTheme(loadSettings())); // Sync the toggle buttons now that they exist.

    // Theme toggle in the header.
    document.querySelectorAll('[data-theme-set]').forEach(function (button) {
      button.addEventListener('click', function () {
        var theme = button.getAttribute('data-theme-set');
        var settings = loadSettings();
        settings.theme = theme;
        saveSettings(settings);
        applyTheme(theme);
      });
    });

    // Mobile navigation.
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('siteNav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });
    }

    // Settings links.
    document.querySelectorAll('[data-open-settings]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (nav) nav.classList.remove('is-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        openSettings();
      });
    });

    loadSummary();
    document.addEventListener('sv:history-changed', loadSummary);
  });
})();
