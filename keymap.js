/* keymap.js — 簡報筆相容（2026-11-21）
 * 各牌子簡報筆送出的按鍵不同：這裡把常見的「下一頁／上一頁」鍵都轉成 PageDown／PageUp，
 * 交給 presenter.js 原本的換頁邏輯（含「先播影片再翻頁」）。
 * F5／Shift+F5（簡報筆的「播放」鍵）與 F 鍵＝切換全螢幕，不會重新整理網頁。
 * 收到不認得的按鍵時，右下角會短暫顯示鍵名，方便查簡報筆送的是什麼。 */
(function () {
  var NEXT = { ArrowDown: 1, Enter: 1, MediaTrackNext: 1, NumpadEnter: 1 };
  var PREV = { ArrowUp: 1, Backspace: 1, MediaTrackPrevious: 1 };
  var KNOWN = { ArrowRight: 1, ArrowLeft: 1, PageDown: 1, PageUp: 1, ' ': 1, Home: 1, End: 1, Escape: 1,
    p: 1, P: 1, o: 1, O: 1, g: 1, G: 1, m: 1, M: 1, e: 1, E: 1, s: 1, S: 1,
    Shift: 1, Control: 1, Alt: 1, Meta: 1, Tab: 1, F11: 1, F12: 1 };

  function editing(t) { return t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)); }
  function fire(key) {
    var ev = new KeyboardEvent('keydown', { key: key, code: key, bubbles: true, cancelable: true });
    (document.activeElement || document.body).dispatchEvent(ev);
  }
  function toggleFull() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) {}
  }
  var tip, tipT;
  function show(text) {
    if (!tip) {
      tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;padding:6px 12px;border-radius:8px;' +
        'background:rgba(16,30,42,.85);color:#fff;font:14px/1.4 "Noto Sans TC","Microsoft JhengHei",sans-serif;pointer-events:none';
      document.body.appendChild(tip);
    }
    tip.textContent = text; tip.hidden = false;
    clearTimeout(tipT); tipT = setTimeout(function () { tip.hidden = true; }, 2500);
  }

  window.addEventListener('keydown', function (e) {
    if (!e.isTrusted || editing(e.target)) return;
    var k = e.key;
    if (k === 'F5' || ((k === 'f' || k === 'F') && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      e.preventDefault(); e.stopImmediatePropagation(); toggleFull(); return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (NEXT[k]) { e.preventDefault(); e.stopImmediatePropagation(); fire('PageDown'); return; }
    if (PREV[k]) { e.preventDefault(); e.stopImmediatePropagation(); fire('PageUp'); return; }
    if (!KNOWN[k]) show('收到按鍵：' + (k === ' ' ? '空白鍵' : k) + '（不是換頁鍵）');
  }, true);

  // 頁面沒有焦點時（例如在 claude.ai 外框裡、剛點過網址列），簡報筆的按鍵送不進來 → 上方提示「先點一下畫面」
  window.addEventListener('load', function () { try { window.focus(); } catch (e) {} });
  var hint;
  function syncHint() {
    if (!document.body) return;
    if (!hint) {
      hint = document.createElement('div');
      hint.textContent = '簡報筆沒反應？先用滑鼠點一下畫面';
      hint.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;padding:8px 18px;border-radius:999px;' +
        'background:#CF3A17;color:#fff;font:600 16px/1.4 "Noto Sans TC","Microsoft JhengHei",sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.2)';
      document.body.appendChild(hint);
    }
    hint.hidden = document.hasFocus();
  }
  window.addEventListener('focus', syncHint);
  window.addEventListener('blur', function () { setTimeout(syncHint, 50); });
  window.addEventListener('load', function () { setTimeout(syncHint, 300); });
  setInterval(syncHint, 1500);
})();
