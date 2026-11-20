/**
 * 編輯模式（2026-10-13，移植自大阪提案 presenter.js 的編輯器，改成獨立檔）
 * 按 E：畫面上的字點一下就能改；圖（SVG）裡的字點一下跳小輸入框，Enter 確定、Esc 取消。
 * 按「儲存」：用 serve.py 開時直接寫回這份 html（舊版自動備份到 deck/backups/）。
 *
 * 存法：HTML 本體不動，修改存在 <script id="deck-edits">（每筆記「原文 o」與「新內容 h」）。
 * 載入時只有原文對得上才套用；AI 之後改了那段字，舊修改不會套到錯的地方（run_checks A17 會列出來）。
 */
(function () {
  var slides = Array.from(document.querySelectorAll('.deck > .slide'));
  if (!slides.length) return;
  var STORE = 'deck-edits-cloud:aicup-student';
  var edits = {};      // id → {o: 原文, h: 新內容, svg: true/false}
  var embMeta = {};
  try {
    var emb = document.getElementById('deck-edits');
    if (emb) { var ej = JSON.parse(emb.textContent || '{}'); edits = ej.edits || {}; embMeta = ej; }
  } catch (e) {}
  var draft = {};
  try { draft = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) {}
  Object.keys(draft).forEach(function (k) { edits[k] = draft[k]; });

  function cleanHTML(s) {
    return String(s).replace(/\s+(?:data-eid|contenteditable|spellcheck)="[^"]*"/g, '')
      .replace(/\sclass="([^"]*)"/g, function (m, c) {
        var v = c.split(/\s+/).filter(function (x) { return x && ['is-editable', 'is-editable-svg', 'is-cleared'].indexOf(x) < 0; }).join(' ');
        return v ? ' class="' + v + '"' : '';
      });
  }
  function isBlank(s) { return /^(?:\s|<br\s*\/?>|&nbsp;)*$/i.test(String(s)); }

  // ── 找出可以改的字 ──
  var targets = [], svgTargets = [], byOrig = {};
  function skip(el) {
    return el.closest('.plan-note, .brand-footer, button, script, style, [data-session]') || el.classList.contains('page-label__num');
  }
  slides.forEach(function (slide, si) {
    var k = 0, j = 0;
    slide.querySelectorAll('*').forEach(function (el) {
      if (el.closest('svg') || skip(el)) return;
      var hasText = Array.from(el.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
      if (!hasText) return;
      var id = (si + 1) + ':' + (k++);
      el.setAttribute('data-eid', id); el.__orig = el.innerHTML; targets.push(el);
      (byOrig[el.__orig] = byOrig[el.__orig] || []).push(el);
    });
    slide.querySelectorAll('svg text, svg tspan').forEach(function (el) {
      if (skip(el) || el.closest('symbol, defs')) return;
      if (el.tagName.toLowerCase() === 'text' && el.querySelector('tspan')) return;
      if (!el.textContent.trim()) return;
      var sid = (si + 1) + ':s' + (j++);
      el.setAttribute('data-eid', sid); el.__orig = el.textContent; svgTargets.push(el);
      (byOrig['svg:' + el.__orig] = byOrig['svg:' + el.__orig] || []).push(el);
    });
  });
  var all = {};
  targets.concat(svgTargets).forEach(function (el) { all[el.getAttribute('data-eid')] = el; });

  // ── 套用修改：原文對得上才套；編號位移時用原文在全份找唯一相符的 ──
  var orphans = [];
  function apply(el, h) {
    if (el.__isSvg || el.closest('svg')) el.textContent = h; else el.innerHTML = h;
    el.classList.toggle('is-cleared', isBlank(h));
  }
  Object.keys(edits).forEach(function (id) {
    var e = edits[id]; if (!e || typeof e !== 'object') return;
    var key = (e.svg ? 'svg:' : '') + e.o;
    var el = all[id];
    var cur = el ? (el.closest('svg') ? el.__orig : el.__orig) : null;
    if (el && cur === e.o) { apply(el, e.h); return; }
    var cands = byOrig[key] || [];
    if (cands.length === 1) {
      var nid = cands[0].getAttribute('data-eid');
      delete edits[id]; edits[nid] = e; apply(cands[0], e.h); return;
    }
    orphans.push(id);
  });
  if (orphans.length) console.warn('[editor] 有 ' + orphans.length + ' 筆修改對不上原文（簡報後來被改過），沒有套用：', orphans);

  if (!(window.__deckCloud && window.__deckCloud.canEdit)) return;   // 只有可編輯的人能改母版

  // ── 工具列 ──
  var css = document.createElement('style');
  css.textContent =
    'html.edit-on .is-editable{outline:1px dashed rgba(0,102,137,.55);outline-offset:2px;cursor:text;}' +
    'html.edit-on .is-editable:hover{outline-color:rgba(0,102,137,.95);}' +
    'html.edit-on .is-editable:focus{outline:2px solid #006689;background:rgba(95,208,245,.18);}' +
    'html.edit-on .is-editable-svg{cursor:text;text-decoration:underline dashed rgba(0,102,137,.8);}' +
    '.is-cleared{display:none!important;}' +
    'html.edit-on .slide .is-cleared{display:block!important;opacity:.35;min-height:1.2em;}' +
    'html.edit-on .slide span.is-cleared{display:inline-block!important;}' +
    'html.edit-on .stepdone{opacity:.55!important;}' +
    'html.edit-on .optans{visibility:visible!important;opacity:.55!important;}' +
    '#edit-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:none;align-items:center;gap:10px;background:#17293A;color:#fff;padding:8px 14px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.3);z-index:2000;font:700 14px/1.2 system-ui,sans-serif;white-space:nowrap;}' +
    'html.edit-on #edit-bar{display:flex;}' +
    '#edit-bar .eb-l{color:#5FD0F5;letter-spacing:.1em;}' +
    '#edit-bar .eb-t{color:rgba(255,255,255,.75);font-weight:500;}' +
    '#edit-bar .eb-s{color:#5FD0F5;min-width:6em;}' +
    '#edit-bar .eb-s.is-bad{color:#FF8A8A;}' +
    '#edit-bar button{font:inherit;font-size:13px;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:4px 12px;cursor:pointer;}' +
    '#edit-bar button:hover{background:rgba(255,255,255,.28);}' +
    '#svg-edit-box{position:fixed;z-index:2100;border:2px solid #006689;border-radius:6px;padding:0 6px;font-family:inherit;}' +
    '@media print{#edit-bar{display:none!important;}}';
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = 'edit-bar';
  bar.innerHTML = '<span class="eb-l">編輯模式</span><span class="eb-t">點字直接改；點圖可換圖（存檔後所有場次都會看到）</span>' +
    '<button type="button" data-act="save">儲存</button><span class="eb-s" id="edit-status"></span>' +
    '<button type="button" data-act="drop">放棄未儲存的修改</button>' +
    '<button type="button" data-act="close">關閉（E）</button>';
  document.body.appendChild(bar);
  ['keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach(function (t) { bar.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
  var status = bar.querySelector('#edit-status');
  function setStatus(t, bad) { status.textContent = t; status.classList.toggle('is-bad', !!bad); }
  var dirty = Object.keys(draft).length > 0;
  if (dirty) setStatus('有未儲存的修改');

  function persist() { try { var o = {}; Object.keys(edits).forEach(function (k) { if (draft[k] !== undefined) o[k] = edits[k]; }); localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {} }
  function record(el, h) {
    var id = el.getAttribute('data-eid'), isSvg = !!el.closest('svg');
    if (h === el.__orig) { delete edits[id]; delete draft[id]; }
    else { edits[id] = { o: el.__orig, h: h, svg: isSvg || undefined }; draft[id] = edits[id]; }
    dirty = true; setStatus('未儲存'); persist();
  }

  var on = false;
  function setEdit(state) {
    on = state;
    document.documentElement.classList.toggle('edit-on', on);
    targets.forEach(function (el) {
      if (on) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'false'); el.classList.add('is-editable'); }
      else { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); el.classList.remove('is-editable'); }
    });
    svgTargets.forEach(function (el) { el.classList.toggle('is-editable-svg', on); });
    if (!on) closeSvgBox(true);
  }

  targets.forEach(function (el) {
    ['keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach(function (t) {
      el.addEventListener(t, function (ev) { if (on) ev.stopPropagation(); });
    });
    el.addEventListener('input', function () {
      if (!on) return;
      var v = cleanHTML(el.innerHTML);
      el.classList.toggle('is-cleared', isBlank(v));
      record(el, v);
    });
  });

  // 圖裡的字
  var svgBox = null, svgBoxEl = null;
  function closeSvgBox(commit) {
    if (!svgBox) return;
    var box = svgBox, el = svgBoxEl; svgBox = null; svgBoxEl = null;
    if (commit && el && box.value !== el.textContent) { el.textContent = box.value; el.classList.toggle('is-cleared', isBlank(box.value)); record(el, box.value); }
    box.remove();
  }
  function openSvgBox(el) {
    closeSvgBox(true);
    var r = el.getBoundingClientRect();
    var box = document.createElement('input');
    box.type = 'text'; box.id = 'svg-edit-box'; box.value = el.textContent; box.setAttribute('spellcheck', 'false');
    box.style.left = Math.max(0, r.left - 6) + 'px'; box.style.top = Math.max(0, r.top - 4) + 'px';
    box.style.minWidth = Math.max(120, r.width + 40) + 'px'; box.style.height = (r.height + 8) + 'px';
    box.style.fontSize = Math.max(12, Math.round(r.height * 0.78)) + 'px';
    ['keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach(function (t) { box.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); closeSvgBox(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeSvgBox(false); }
    });
    box.addEventListener('blur', function () { setTimeout(function () { if (svgBox === box) closeSvgBox(true); }, 0); });
    document.body.appendChild(box); svgBox = box; svgBoxEl = el; box.focus(); box.select();
  }
  svgTargets.forEach(function (el) {
    el.addEventListener('mousedown', function (ev) { if (on) ev.stopPropagation(); });
    el.addEventListener('click', function (ev) { if (!on) return; ev.stopPropagation(); ev.preventDefault(); openSvgBox(el); });
  });

  // 編輯模式下，點投影片空白處不翻頁、不觸發「點一下揭曉」
  document.addEventListener('click', function (ev) {
    if (!on || !ev.target.closest('.deck')) return;
    var t = ev.target.closest('[data-eid]');
    if (t && t.closest('svg')) { ev.preventDefault(); openSvgBox(t); }
    ev.stopPropagation();
  }, true);

  // ── 儲存：讀磁碟上的原檔，只換掉 deck-edits 那一段再寫回（HTML 本體一個字都不動）──
  function escJSON(o) { return JSON.stringify(o, null, 1).replace(/<\/script/gi, '<\\/script'); }
  async function save() {
    closeSvgBox(true);
    try {
      setStatus('儲存中…');
      var keep = {};
      Object.keys(edits).forEach(function (k) { keep[k] = edits[k]; });
      await window.__deckCloud.saveEdits(keep);
      draft = {}; try { localStorage.removeItem(STORE); } catch (e) {}
      var d = new Date();
      dirty = false; setStatus('已儲存 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'));
    } catch (e) { setStatus('儲存失敗（修改還留在這台電腦），請再按一次', true); }
  }

  var dropArmed = false;
  bar.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'close') setEdit(false);
    if (act === 'save') save();
    if (act === 'drop') {
      if (!dropArmed) { dropArmed = true; b.textContent = '再按一次確認'; setTimeout(function () { dropArmed = false; b.textContent = '放棄未儲存的修改'; }, 3000); return; }
      try { localStorage.removeItem(STORE); } catch (e) {}
      location.reload();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setEdit(!on); }
  });
})();
