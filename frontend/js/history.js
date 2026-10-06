/* ==========================================================================
   history.js - History page: list, reuse, delete and clear
   ========================================================================== */
(function () {
  'use strict';

  var SV = window.SV;
  var REUSE_KEY = 'sv.reuse';
  var PAGE_SIZE = 200;
  var PREVIEW_LENGTH = 220;

  document.addEventListener('DOMContentLoaded', function () {
    var list = document.getElementById('historyList');
    if (!list) return;

    var countEl = document.getElementById('historyCount');
    var clearBtn = document.getElementById('clearHistoryBtn');
    var el = SV.util.el;

    /* ----- Rendering ----- */
    function showLoading() {
      list.textContent = '';
      countEl.textContent = 'Loading history...';
      for (var i = 0; i < 4; i++) list.appendChild(el('div', 'skeleton history-skeleton'));
      clearBtn.disabled = true;
    }

    function showEmpty() {
      list.textContent = '';
      var box = el('div', 'card empty-state');
      box.appendChild(el('p', 'empty-title', 'No speech history available.'));
      box.appendChild(el('p', '', 'Speech you generate on the home page is saved here so you can use it again.'));
      var link = el('a', 'btn btn-primary', 'Go to the home page');
      link.href = '/';
      box.appendChild(link);
      list.appendChild(box);
      countEl.textContent = 'No saved requests';
      clearBtn.disabled = true;
    }

    function showError(message) {
      list.textContent = '';
      var box = el('div', 'card empty-state');
      box.appendChild(el('p', 'empty-title', 'History could not be loaded.'));
      box.appendChild(el('p', '', message));
      var retry = el('button', 'btn btn-primary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', load);
      box.appendChild(retry);
      list.appendChild(box);
      countEl.textContent = 'History unavailable';
      clearBtn.disabled = true;
    }

    function updateCount(total) {
      countEl.textContent = total + (total === 1 ? ' saved request' : ' saved requests');
      clearBtn.disabled = total === 0;
    }

    function stat(label, value) {
      var span = el('span');
      span.append(label + ': ');
      span.appendChild(el('strong', '', value));
      return span;
    }

    function buildCard(item) {
      var card = el('article', 'card history-card');
      card.dataset.id = item.id;

      var top = el('div', 'history-meta-top');
      top.appendChild(el('span', 'badge', SV.voices.languageLabel(item.language)));
      top.appendChild(el('span', 'badge badge-quiet', item.voice));
      top.appendChild(el('time', 'history-date', SV.util.formatDateTime(item.created_at)));
      card.appendChild(top);

      var preview = item.text.length > PREVIEW_LENGTH ? item.text.slice(0, PREVIEW_LENGTH).trimEnd() + '...' : item.text;
      card.appendChild(el('p', 'history-text', preview));

      var stats = el('p', 'history-stats');
      stats.appendChild(stat('Words', SV.util.formatNumber(item.word_count)));
      stats.appendChild(stat('Characters', SV.util.formatNumber(item.character_count)));
      stats.appendChild(stat('Speed', Number(item.rate).toFixed(1) + 'x'));
      stats.appendChild(stat('Pitch', Number(item.pitch).toFixed(1)));
      stats.appendChild(stat('Volume', Math.round(item.volume) + '%'));
      card.appendChild(stats);

      var actions = el('div', 'history-actions');
      var reuse = el('button', 'btn btn-primary btn-sm', 'Use Again');
      reuse.type = 'button';
      reuse.addEventListener('click', function () { useAgain(item); });
      var remove = el('button', 'btn btn-secondary btn-sm', 'Delete');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Delete history item from ' + SV.util.formatDateTime(item.created_at));
      remove.addEventListener('click', function () { deleteItem(item, card, remove); });
      actions.append(reuse, remove);
      card.appendChild(actions);
      return card;
    }

    function render(data) {
      list.textContent = '';
      if (!data.items.length) {
        showEmpty();
        return;
      }
      data.items.forEach(function (item) { list.appendChild(buildCard(item)); });
      if (data.total > data.items.length) {
        list.appendChild(el('p', 'history-note', 'Showing the latest ' + data.items.length + ' of ' + data.total + ' requests.'));
      }
      updateCount(data.total);
    }

    /* ----- Actions ----- */
    function load() {
      showLoading();
      SV.api('/api/history?limit=' + PAGE_SIZE).then(render, function (error) { showError(error.message); });
    }

    function useAgain(item) {
      try {
        sessionStorage.setItem(REUSE_KEY, JSON.stringify({
          text: item.text, language: item.language, voice: item.voice,
          rate: item.rate, pitch: item.pitch, volume: item.volume
        }));
      } catch (error) {
        SV.toast('Your browser blocked passing this item to the home page.', 'error');
        return;
      }
      window.location.href = '/';
    }

    function deleteItem(item, card, button) {
      button.disabled = true;
      SV.api('/api/history/' + item.id, { method: 'DELETE' }).then(
        function () {
          card.classList.add('is-removing');
          window.setTimeout(function () {
            card.remove();
            // Reload so the count and the "latest N" note stay accurate.
            load();
          }, 250);
          SV.toast('History item deleted.', 'success');
        },
        function (error) {
          button.disabled = false;
          if (error.status === 404) {
            SV.toast(error.message, 'warning');
            load();
          } else {
            SV.toast('The item could not be deleted. ' + error.message, 'error');
          }
        }
      );
    }

    clearBtn.addEventListener('click', function () { SV.clearHistory(); });
    document.addEventListener('sv:history-changed', load);

    load();
  });
})();
