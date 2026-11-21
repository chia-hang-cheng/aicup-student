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

  // 載入後讓頁面拿到焦點，簡報筆的按鍵才送得進來
  window.addEventListener('load', function () { try { window.focus(); } catch (e) {} });
})();
