/* lazyload.js — 公開網站版：圖片延後載入（2026-11-20）
 * 第一頁以外的圖改成 data-lazysrc，先讓簡報秒開；
 * 目前這頁＋後兩頁優先載，其餘依頁序在背景慢慢載（同時 3 張），影片最後才預載。 */
(function () {
  function load(img) {
    var u = img.getAttribute('data-lazysrc'); if (!u) return null;
    img.removeAttribute('data-lazysrc');
    return new Promise(function (ok) { img.onload = img.onerror = function () { ok(); }; img.src = u; });
  }
  function warmVideos(root) { (root || document).querySelectorAll('video[data-lazypreload]').forEach(function (v) { v.removeAttribute('data-lazypreload'); v.preload = 'auto'; try { v.load(); } catch (e) {} }); }
  function priority() {
    var a = document.querySelector('.deck > .slide.active'); if (!a) return;
    var s = a;
    for (var i = 0; i < 3 && s; i++, s = s.nextElementSibling) {
      s.querySelectorAll('img[data-lazysrc]').forEach(load);
      if (i === 0) warmVideos(s);
    }
  }
  setInterval(priority, 250);
  function worker() {
    var img = document.querySelector('.deck img[data-lazysrc]');
    if (!img) { warmVideos(); return; }
    var p = load(img); (p || Promise.resolve()).then(worker);
  }
  function start() { for (var i = 0; i < 3; i++) worker(); }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
