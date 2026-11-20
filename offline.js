/**
 * cloud.js — 學生工作坊簡報的 claude.ai 版（2026-11-05）
 *
 * 啟動順序（presenter.js 一載入就抓 .slide，所以頁面要先整理好才載它）：
 *   1. 連 db：讀「母版修改」master/content 與目前選的場次 sessions/<id>
 *   2. 母版：文字修改塞進 #deck-edits 交給 editor-cloud.js；換過的圖套上 /_blob/<id>
 *   3. 場次：登入 QR、講師介紹頁（沒開就把那頁拿掉）
 *   4. 依序載入 editor-cloud.js → presenter.js → autocol.js
 *
 * 權限：母版（文字、圖）只有可編輯的人（擁有者／編輯者）能改；
 *       場次設定 sessions/* 是「可互動」以上的同事都能新增、修改。
 * 場次的 QR 與講師照片縮成小圖，直接以 data:image 存進場次文件，不另外上傳檔案。
 */
(function () {
  'use strict';
  var SESSION_KEY = 'aicup-student-session';
  var INS_KEY = 'aicup-last-instructor';   // 這台瀏覽器上次用的講師（新場次自動帶入）
  var deck = document.querySelector('.deck');
  var state = { db: null, user: null, assets: null, canEdit: false, canWrite: null, master: { edits: {}, images: {} }, sessions: [], instructors: [], current: null };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function isImgData(s) { return typeof s === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(s); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]); }

  // ── 載入遮罩 ──
  var veil = el('div', 'cl-veil', '載入場次設定…');
  document.body.appendChild(veil);

  // ════════════ 1. 連線 ════════════
  async function connect() {
    if (!window.claude || !window.claude.use) return;
    var res = await withTimeout(Promise.all([claude.use('db'), claude.use('user'), claude.use('assets')]), 9000);
    if (!res) return;
    state.db = res[0]; state.user = res[1]; state.assets = res[2];
    if (state.user) {
      state.canEdit = await state.user.canEdit();
      state.canWrite = await state.user.can('data.write');
    }
    state.previewMode = lsGet(SESSION_KEY) === '__ws' ? 'workshop' : 'school';   // 沒選場次時看哪個母版
    if (!state.db) return;
    try {
      var snaps = await withTimeout(Promise.all([
        state.db.doc('master/content').get(),
        state.db.collection('sessions').orderBy('updated', 'desc').limit(200).get(),
        state.db.collection('instructors').orderBy('updated', 'desc').limit(100).get().catch(function () { return { docs: [] }; })
      ]), 9000);
      if (!snaps) return;
      if (snaps[0].exists) {
        var m = snaps[0].data() || {};
        state.master = { edits: m.edits || {}, images: m.images || {} };
      }
      state.sessions = snaps[1].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      state.instructors = (snaps[2] && snaps[2].docs || []).map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (e) { console.warn('[cloud] 讀取失敗', e); }
    var want = lsGet(SESSION_KEY);
    state.current = state.sessions.filter(function (s) { return s.id === want; })[0] || null;
  }

  // ════════════ 2. 母版修改 ════════════
  function applyMaster() {
    var emb = document.getElementById('deck-edits');
    if (emb) {
      var j = {}; try { j = JSON.parse(emb.textContent || '{}'); } catch (e) {}
      j.edits = Object.assign({}, j.edits || {}, state.master.edits || {});
      emb.textContent = JSON.stringify(j);
    }
    Object.keys(state.master.images || {}).forEach(function (key) {
      var img = imgByKey(key), id = state.master.images[key];
      if (img && /^[0-9a-f]{32}$/.test(id)) img.src = '/_blob/' + id;
    });
  }
  function imgKey(img) {
    var s = img.closest('.deck > .slide'); if (!s) return null;
    return s.getAttribute('data-sid') + ':' + Array.from(s.querySelectorAll('img')).indexOf(img);
  }
  function imgByKey(key) {
    var p = key.split(':'), s = deck.querySelector('.slide[data-sid="' + p[0] + '"]');
    return s ? s.querySelectorAll('img')[+p[1]] : null;
  }
  // 母版文件：一次只寫一筆，讀最新的再合併
  var masterQueue = Promise.resolve();
  function saveMaster(patch) {
    masterQueue = masterQueue.then(async function () {
      var ref = state.db.doc('master/content');
      var snap = await ref.get();
      var cur = snap.exists ? (snap.data() || {}) : {};
      var next = { edits: Object.assign({}, cur.edits || {}), images: Object.assign({}, cur.images || {}) };
      if (patch.edits) next.edits = patch.edits;
      if (patch.images) Object.assign(next.images, patch.images);
      next.updated = new Date().toISOString();
      await ref.set(next);
      state.master = next;
    });
    return masterQueue;
  }

  // ════════════ 3. 場次 ════════════
  // 工作坊：角落小 QR 改成「創作與投稿專區」（家長可能還沒登入成功）
  var AUTH_URL = 'https://ai-award.numeracylab.com/auth/';
  function workshopMiniQr() {
    var src = null;
    if (window.qrcode) { try { var q = qrcode(0, 'M'); q.addData(AUTH_URL); q.make(); src = q.createDataURL(8, 2); } catch (e) {} }
    deck.querySelectorAll('.x7-qrmini').forEach(function (f) {
      var img = f.querySelector('.st-qr-img'), miss = f.querySelector('.st-qr-missing'), cap = f.querySelector('figcaption');
      if (src) { img.src = src; img.hidden = false; if (miss) miss.hidden = true; } else { f.hidden = true; }
      if (cap) cap.innerHTML = f.getAttribute('data-cap') || '還沒登入？<br>掃這裡進<br>創作與投稿專區';
    });
  }
  // 第 2 頁「家長先幫孩子登入」：大 QR 固定連到創作與投稿專區
  function parentQr() {
    var src = null;
    if (window.qrcode) { try { var q = qrcode(0, 'M'); q.addData(AUTH_URL); q.make(); src = q.createDataURL(10, 2); } catch (e) {} }
    deck.querySelectorAll('.x8-parent__qr').forEach(function (f) { if (src) f.querySelector('img').src = src; else f.hidden = true; });
  }
  function modeOf(s) { return s && s.mode === 'workshop' ? 'workshop' : 'school'; }
  function qrSrc(s) {
    if (!s) return null;
    var qr = s.qr || {};
    if (isImgData(qr.image)) return qr.image;
    var url = qr.url;
    if (url && /^https?:\/\//.test(url) && window.qrcode) {
      try { var q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createDataURL(8, 2); } catch (e) {}
    }
    return null;
  }
  function applySession() {
    var s = state.current, src = qrSrc(s);
    deck.querySelectorAll('.st-qr-img').forEach(function (img) {
      var box = img.closest('figure');
      var miss = box && box.querySelector('.st-qr-missing');
      if (src) { img.src = src; img.hidden = false; if (miss) miss.hidden = true; }
      else { img.hidden = true; if (miss) miss.hidden = false; }
    });
    deck.querySelectorAll('.st-qr-cap').forEach(function (c) {
      c.textContent = s && s.name ? '用平板掃 QR code｜' + s.name : '用平板掃 QR code';
    });
    var intro = deck.querySelector('.slide[data-sid="intro"]');
    var it = s && s.intro;
    if (intro && it && it.on) {
      $('.st-intro__name', intro).textContent = String(it.name || '').trim().replace(/\s*老師$/, '');   // 「老師」由 CSS 自動補上
      $('.st-intro__title', intro).textContent = it.title || '';
      var bio = $('.st-intro__bio', intro); bio.textContent = '';
      String(it.bio || '').split(/\n+/).filter(Boolean).forEach(function (line) { bio.appendChild(el('li', null, line)); });
      var ph = $('.st-intro__photo', intro);
      if (isImgData(it.photo)) { ph.src = it.photo; ph.hidden = false; } else { ph.hidden = true; }
      return true;
    }
    return false;
  }
  function renumber() {
    Array.from(deck.querySelectorAll('.deck > .slide')).forEach(function (s, i) {
      var n = s.querySelector('.page-label__num'); if (n) n.textContent = String(i + 1).padStart(2, '0');
    });
  }

  // ════════════ 4. 依序載入其他 script ════════════
  function loadScript(src) {
    return new Promise(function (ok) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ok; document.body.appendChild(s); });
  }

  // ════════════ 場次設定面板（按 S 或右下角按鈕）════════════
  var panel, form, toast;
  function say(t, bad) {
    toast.textContent = t; toast.classList.toggle('is-bad', !!bad); toast.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(function () { toast.hidden = true; }, 4000);
  }
  function buildPanel() {
    toast = el('div', 'cl-toast'); toast.hidden = true; document.body.appendChild(toast);
    var btn = el('button', 'cl-fab', '場次'); btn.type = 'button'; btn.title = '場次設定（S）';
    btn.addEventListener('click', function (e) { e.stopPropagation(); openPanel(); });
    document.body.appendChild(btn);
    var badge = el('div', 'cl-badge'); document.body.appendChild(badge);
    showBadge();

    panel = el('div', 'cl-panel'); panel.hidden = true;
    panel.innerHTML =
      '<div class="cl-card" role="dialog" aria-label="場次設定">' +
      '<div class="cl-hd"><b>場次設定</b><button type="button" class="cl-x" data-act="close" aria-label="關閉">×</button></div>' +
      '<p class="cl-note" id="cl-perm"></p>' +
      '<label class="cl-row"><span>目前場次</span><select id="cl-pick"></select></label>' +
      '<form id="cl-form" class="cl-form">' +
      '<label class="cl-row"><span>場次名稱</span><input id="cl-name" maxlength="60" placeholder="例：1121 板橋國小 五年級"></label>' +
      '<fieldset class="cl-fs"><legend>場次類型</legend><div class="cl-mode">' +
      '<label><input type="radio" name="cl-mode" value="school"> 入校（學校老師給帳號）</label>' +
      '<label><input type="radio" name="cl-mode" value="workshop"> 工作坊（家長申請帳號）</label></div>' +
      '<p class="cl-hint">工作坊會換成「家長申請帳號」的頁面，拿掉發平板、登入編號、登入 QR 等頁；工作坊不用設定登入 QR。</p></fieldset>' +
      '<fieldset class="cl-fs"><legend>加入的段落</legend><label><input type="checkbox" id="cl-hakka"> 客家文化與〈同心圓〉（客家園區場，接在「最不孤獨」後面，約 12 頁）</label><label><input type="checkbox" id="cl-parent"> 家長先登入帳號（家長開場後離場：第 2 頁教家長登入；中段申請帳號頁換成孩子自己重新登入的 QR 頁）</label></fieldset>' +
      '<fieldset class="cl-fs"><legend>數感盃登入 QR</legend>' +
      '<div class="cl-qr"><img id="cl-qr-prev" alt="QR 預覽" hidden><span id="cl-qr-empty">尚未設定</span></div>' +
      '<div class="cl-btns"><label class="cl-file">上傳 QR 圖片<input type="file" id="cl-qr-file" accept="image/*"></label>' +
      '<button type="button" data-act="qr-clear">清除</button></div>' +
      '<label class="cl-row"><span>或貼網址</span><input id="cl-qr-url" placeholder="https://… 貼上後會自動產生 QR"></label>' +
      '<p class="cl-hint">學校老師給的是圖片就上傳圖片；給的是連結就貼網址。也可以直接在這裡 Ctrl+V 貼上截圖。</p></fieldset>' +
      '<fieldset class="cl-fs"><legend><label><input type="checkbox" id="cl-intro-on"> 放講師介紹頁（第 2 頁）</label></legend>' +
      '<div id="cl-intro-box">' +
      '<label class="cl-row"><span>選講師</span><select id="cl-ins-pick"></select></label>' +
      '<p class="cl-hint">存過一次的講師會留在清單裡，下次選名字就自動帶入；新增場次時會先帶入你上次用的講師。' +
      '<button type="button" data-act="ins-delete" class="cl-link" hidden>從清單移除這位講師</button></p>' +
      '<label class="cl-row"><span>姓名</span><input id="cl-intro-name" maxlength="30"></label>' +
      '<label class="cl-row"><span>頭銜／單位</span><input id="cl-intro-title" maxlength="60" placeholder="例：數感實驗室 講師"></label>' +
      '<label class="cl-row cl-row--top"><span>介紹</span><textarea id="cl-intro-bio" rows="4" placeholder="一行一點，最多 5 行"></textarea></label>' +
      '<div class="cl-btns"><img id="cl-photo-prev" alt="照片預覽" hidden><label class="cl-file">上傳照片<input type="file" id="cl-photo-file" accept="image/*"></label>' +
      '<button type="button" data-act="photo-clear">移除照片</button></div></div></fieldset>' +
      '<div class="cl-foot"><button type="submit" class="cl-primary">儲存並套用</button>' +
      '<button type="button" data-act="delete" class="cl-danger">刪除這個場次</button></div>' +
      '</form></div>';
    document.body.appendChild(panel);
    form = $('#cl-form', panel);
    ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'paste'].forEach(function (t) { panel.addEventListener(t, function (e) { e.stopPropagation(); }); });
    panel.addEventListener('click', function (e) { if (e.target === panel) closePanel(); });
    panel.addEventListener('click', onPanelClick);
    $('#cl-pick', panel).addEventListener('change', onPick);
    $('#cl-qr-file', panel).addEventListener('change', function (e) { readImage(e.target.files[0], 600, 'image/png').then(setQrImage); });
    $('#cl-photo-file', panel).addEventListener('change', function (e) { readImage(e.target.files[0], 500, 'image/jpeg').then(setPhoto); });
    $('#cl-qr-url', panel).addEventListener('input', previewQr);
    $('#cl-intro-on', panel).addEventListener('change', syncIntroBox);
    panel.querySelectorAll('input[name="cl-mode"]').forEach(function (r) { r.addEventListener('change', previewQr); });
    $('#cl-ins-pick', panel).addEventListener('change', function (e) {
      var it = insById(e.target.value);
      if (it) applyInstructor(it); else { draft.intro.instructorId = null; syncInsDelete(); }
    });
    panel.addEventListener('paste', function (e) {
      var f = Array.from((e.clipboardData || {}).files || []).filter(function (x) { return /^image\//.test(x.type); })[0];
      if (f) { e.preventDefault(); readImage(f, 600, 'image/png').then(setQrImage); }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); saveSession(); });
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); panel.hidden ? openPanel() : closePanel(); }
      if (e.key === 'Escape' && !panel.hidden) closePanel();
    });
  }
  function showBadge() {
    var b = $('.cl-badge');
    b.textContent = state.current ? '場次：' + (state.current.name || '未命名') : '母版預覽：' + (state.previewMode === 'workshop' ? '工作坊版' : '入校版') + '（按 S 切換）';
    b.classList.toggle('is-empty', !state.current);
  }
  var draft = null;   // 面板正在編輯的場次（未存）
  function blank() { return { id: null, name: '', mode: state.previewMode || 'school', qr: {}, intro: { on: false } }; }
  function openPanel() {
    var perm = $('#cl-perm', panel);
    if (!state.db) perm.textContent = '目前連不到資料庫，只能看母版。請在 claude.ai 上登入後開啟。';
    else if (state.canWrite === false) perm.textContent = '你的權限只能檢視，不能新增或修改場次；請擁有者把你設成「可互動」以上。';
    else perm.textContent = '每個場次各自一筆，存檔後只會套用到你選的這個場次。';
    fillPick();
    loadDraft(state.current ? JSON.parse(JSON.stringify(state.current)) : blank());
    panel.hidden = false;
  }
  function closePanel() { panel.hidden = true; }
  function fillPick() {
    var sel = $('#cl-pick', panel); sel.textContent = '';
    var o0 = el('option', null, '（只看母版：入校版）'); o0.value = ''; sel.appendChild(o0);
    var o1 = el('option', null, '（只看母版：工作坊版）'); o1.value = '__ws'; sel.appendChild(o1);
    state.sessions.forEach(function (s) { var o = el('option', null, s.name || '未命名場次'); o.value = s.id; sel.appendChild(o); });
    var on = el('option', null, '＋ 新增場次'); on.value = '__new'; sel.appendChild(on);
    sel.value = state.current ? state.current.id : (state.previewMode === 'workshop' ? '__ws' : '');
  }
  function onPick(e) {
    var v = e.target.value;
    if (v === '__new') { loadDraft(blank()); $('#cl-name', panel).focus(); return; }
    if (v === '') { lsSet(SESSION_KEY, null); location.reload(); return; }
    if (v === '__ws') { lsSet(SESSION_KEY, '__ws'); location.reload(); return; }
    lsSet(SESSION_KEY, v); location.reload();
  }
  function loadDraft(s) {
    draft = s; draft.qr = draft.qr || {}; draft.intro = draft.intro || { on: false };
    $('#cl-name', panel).value = s.name || '';
    var mr = $('input[name="cl-mode"][value="' + modeOf(s) + '"]', panel); if (mr) mr.checked = true;
    $('#cl-qr-url', panel).value = draft.qr.url || '';
    $('#cl-hakka', panel).checked = !!(s.topics && s.topics.hakka);
    $('#cl-parent', panel).checked = !!(s.topics && s.topics.parent);
    $('#cl-intro-on', panel).checked = !!draft.intro.on;
    $('#cl-intro-name', panel).value = draft.intro.name || '';
    $('#cl-intro-title', panel).value = draft.intro.title || '';
    $('#cl-intro-bio', panel).value = draft.intro.bio || '';
    setPhoto(draft.intro.photo || null, true);
    // 講師清單：場次已有講師就選那位；新場次（還沒填講師）自動帶入這台瀏覽器上次用的講師
    var known = insById(draft.intro.instructorId) || insByName(draft.intro.name);
    fillInsPick(known ? known.id : '');
    if (!s.id && !draft.intro.name) {
      var last = insById(lsGet(INS_KEY));
      if (last) applyInstructor(last);
    }
    previewQr(); syncIntroBox();
    $('[data-act="delete"]', panel).hidden = !s.id;
  }
  function insById(id) { return id ? state.instructors.filter(function (x) { return x.id === id; })[0] || null : null; }
  function insByName(name) { name = (name || '').trim(); return name ? state.instructors.filter(function (x) { return (x.name || '').trim() === name; })[0] || null : null; }
  function fillInsPick(selected) {
    var sel = $('#cl-ins-pick', panel); sel.textContent = '';
    var o0 = el('option', null, state.instructors.length ? '（新的講師，自己填）' : '（還沒有存過講師，自己填）'); o0.value = ''; sel.appendChild(o0);
    state.instructors.forEach(function (x) { var o = el('option', null, x.name + (x.title ? '｜' + x.title : '')); o.value = x.id; sel.appendChild(o); });
    sel.value = selected || '';
    syncInsDelete();
  }
  function syncInsDelete() { $('[data-act="ins-delete"]', panel).hidden = !$('#cl-ins-pick', panel).value; }
  function applyInstructor(it) {
    draft.intro.instructorId = it.id;
    $('#cl-intro-on', panel).checked = true;
    $('#cl-intro-name', panel).value = it.name || '';
    $('#cl-intro-title', panel).value = it.title || '';
    $('#cl-intro-bio', panel).value = it.bio || '';
    setPhoto(it.photo || null, true);
    $('#cl-ins-pick', panel).value = it.id;
    syncIntroBox(); syncInsDelete();
  }
  // 存場次時順便存講師：同一位（選過或同名）就更新，否則新增一筆
  async function saveInstructor(intro) {
    if (!intro.on || !intro.name) return null;
    var it = insById(draft.intro.instructorId) || insByName(intro.name);
    var ref = it ? state.db.doc('instructors/' + it.id) : state.db.collection('instructors').doc();
    var body = { name: intro.name, title: intro.title, bio: intro.bio, photo: intro.photo, updated: new Date().toISOString() };
    if (state.user) { try { body.by = await state.user.id(); } catch (e) {} }
    try { await ref.set(body); lsSet(INS_KEY, ref.id); return ref.id; }
    catch (e) { console.warn('[cloud] 講師存檔失敗', e); return it ? it.id : null; }
  }
  async function deleteInstructor() {
    var id = $('#cl-ins-pick', panel).value; if (!id) return;
    try {
      await state.db.doc('instructors/' + id).delete();
      state.instructors = state.instructors.filter(function (x) { return x.id !== id; });
      if (lsGet(INS_KEY) === id) lsSet(INS_KEY, null);
      if (draft.intro.instructorId === id) draft.intro.instructorId = null;
      fillInsPick('');
      say('已從講師清單移除（已存的場次不受影響）');
    } catch (e) { say('移除失敗：沒有權限或連線中斷', true); }
  }
  function syncIntroBox() { $('#cl-intro-box', panel).classList.toggle('is-off', !$('#cl-intro-on', panel).checked); }
  function setQrImage(data) { if (!data) return; draft.qr.image = data; $('#cl-qr-url', panel).value = ''; draft.qr.url = ''; previewQr(); }
  function previewQr() {
    var url = $('#cl-qr-url', panel).value.trim();
    if (url) { draft.qr.url = url; draft.qr.image = null; }
    var src = qrSrc({ qr: draft.qr }), img = $('#cl-qr-prev', panel), empty = $('#cl-qr-empty', panel);
    img.hidden = !src; empty.hidden = !!src; if (src) img.src = src;
    if (url && !/^https?:\/\//.test(url)) { empty.hidden = false; empty.textContent = '網址要以 https:// 開頭'; }
    else { var mc = $('input[name="cl-mode"]:checked', panel); empty.textContent = mc && mc.value === 'workshop' ? '工作坊不用設定' : '尚未設定'; }
  }
  function setPhoto(data, silent) {
    if (!silent && !data) return;
    draft.intro.photo = data || null;
    var img = $('#cl-photo-prev', panel); img.hidden = !data; if (data) img.src = data;
  }
  // 讀圖並縮小，轉成 data URL（存進場次文件；文件上限 256KB）
  function readImage(file, max, type) {
    return new Promise(function (ok) {
      if (!file || !/^image\//.test(file.type)) { say('請選圖片檔', true); return ok(null); }
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var r = Math.min(1, max / Math.max(im.width, im.height));
        var c = document.createElement('canvas'); c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
        var g = c.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingEnabled = type !== 'image/png'; g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL(type, 0.85));
      };
      im.onerror = function () { say('這張圖讀不出來，換一張試試', true); ok(null); };
      im.src = url;
    });
  }
  function onPanelClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'close') closePanel();
    if (act === 'qr-clear') { draft.qr = {}; $('#cl-qr-url', panel).value = ''; previewQr(); }
    if (act === 'photo-clear') { draft.intro.photo = null; $('#cl-photo-prev', panel).hidden = true; }
    if (act === 'ins-delete') {
      if (!b.classList.contains('is-armed')) { b.classList.add('is-armed'); b.textContent = '再按一次確認移除'; setTimeout(function () { b.classList.remove('is-armed'); b.textContent = '從清單移除這位講師'; }, 3000); return; }
      b.classList.remove('is-armed'); b.textContent = '從清單移除這位講師';
      deleteInstructor();
    }
    if (act === 'delete') {
      if (!b.classList.contains('is-armed')) { b.classList.add('is-armed'); b.textContent = '再按一次確認刪除'; setTimeout(function () { b.classList.remove('is-armed'); b.textContent = '刪除這個場次'; }, 3000); return; }
      deleteSession();
    }
  }
  async function saveSession() {
    if (!state.db) { say('連不到資料庫，無法儲存', true); return; }
    var name = $('#cl-name', panel).value.trim();
    if (!name) { say('請先填場次名稱', true); $('#cl-name', panel).focus(); return; }
    var mchk = $('input[name="cl-mode"]:checked', panel);
    var body = {
      name: name,
      mode: mchk && mchk.value === 'workshop' ? 'workshop' : 'school',
      topics: { hakka: $('#cl-hakka', panel).checked, parent: $('#cl-parent', panel).checked },
      qr: { image: draft.qr.image || null, url: (draft.qr.url || '').trim() || null },
      intro: {
        on: $('#cl-intro-on', panel).checked,
        name: $('#cl-intro-name', panel).value.trim(),
        title: $('#cl-intro-title', panel).value.trim(),
        bio: $('#cl-intro-bio', panel).value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5).join('\n'),
        photo: draft.intro.photo || null
      },
      updated: new Date().toISOString()
    };
    if (state.user) { try { body.by = await state.user.id(); } catch (e) {} }
    var ref = draft.id ? state.db.doc('sessions/' + draft.id) : state.db.collection('sessions').doc();
    var btn = $('.cl-primary', panel); btn.disabled = true; btn.textContent = '儲存中…';
    try {
      body.intro.instructorId = await saveInstructor(body.intro);
      await ref.set(body);
      lsSet(SESSION_KEY, ref.id);
      say('已儲存，套用中…');
      setTimeout(function () { location.reload(); }, 400);
    } catch (e) {
      btn.disabled = false; btn.textContent = '儲存並套用';
      if (e && e.code === 'invalid_argument') say('沒有修改權限，或圖片太大（請換小一點的圖）', true);
      else if (e && e.code === 'quota_exceeded') say('資料庫已滿，請先刪掉舊場次', true);
      else say('儲存失敗，請再按一次', true);
    }
  }
  async function deleteSession() {
    try {
      await state.db.doc('sessions/' + draft.id).delete();
      if (lsGet(SESSION_KEY) === draft.id) lsSet(SESSION_KEY, null);
      say('已刪除'); setTimeout(function () { location.reload(); }, 400);
    } catch (e) { say('刪除失敗：沒有權限或連線中斷', true); }
  }

  // ════════════ 擁有者換母版圖片（編輯模式下點圖）════════════
  function setupImageSwap() {
    if (!state.canEdit || !state.assets) return;
    var picker = el('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/gif,image/webp'; picker.hidden = true;
    document.body.appendChild(picker);
    var pending = null;
    window.addEventListener('click', function (ev) {
      if (!document.documentElement.classList.contains('edit-on')) return;
      if (ev.target.closest('.is-editable, [contenteditable="true"], #edit-bar, .cl-panel, .cl-fab')) return;
      var slide = ev.target.closest('.deck > .slide'); if (!slide) return;
      var img = document.elementsFromPoint(ev.clientX, ev.clientY).filter(function (x) { return x.tagName === 'IMG' && slide.contains(x); })[0];
      if (!img || img.hasAttribute('data-session')) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      pending = img; picker.value = ''; picker.click();
    }, true);
    picker.addEventListener('change', async function () {
      var f = picker.files && picker.files[0], img = pending; pending = null;
      if (!f || !img) return;
      try {
        say('換圖中…');
        var up = await state.assets.upload(f);
        var patch = {}; patch[imgKey(img)] = up.id;
        await saveMaster({ images: patch });
        img.src = up.url;
        say('已換圖並存檔');
      } catch (e) {
        say(e && e.code === 'too_large' ? '圖太大（上限 20MB）' : e && e.code === 'unsupported_type' ? '只收 png／jpg／gif／webp' : '換圖失敗，請再試一次', true);
      }
    });
  }

  // ════════════ 啟動 ════════════
  async function boot() {
    var OFF = window.__OFFLINE || {};
    state.master = OFF.master || { edits: {}, images: {} };
    state.current = OFF.session || null;
    state.previewMode = OFF.previewMode || 'school';
    applyMaster();
    var introOn = applySession();
    window.__deckCloud = {
      canEdit: state.canEdit && !!state.db,
      saveEdits: function (edits) { return saveMaster({ edits: edits }); }
    };
    await loadScript('editor-cloud.js');            // 先讓編輯器用「完整版」頁碼建索引
    if (!introOn) { var s = deck.querySelector('.slide[data-sid="intro"]'); if (s) s.remove(); }
    // 場次類型：入校（school）／工作坊（workshop），拿掉另一種專用的頁
    var mode = state.current ? modeOf(state.current) : (state.previewMode || 'school');
    deck.querySelectorAll('.deck > .slide[data-mode]').forEach(function (x) { if (x.getAttribute('data-mode') !== mode) x.remove(); });
    document.documentElement.setAttribute('data-deck-mode', mode);
    // 加入的段落：場次有勾才留（例：客家園區場 data-topic="hakka"）
    var topics = (state.current && state.current.topics) || {};
    deck.querySelectorAll('.deck > .slide[data-topic]').forEach(function (x) { if (!topics[x.getAttribute('data-topic')]) x.remove(); });
    deck.querySelectorAll('.deck > .slide[data-notopic]').forEach(function (x) { if (topics[x.getAttribute('data-notopic')]) x.remove(); });
    if (mode === 'workshop') workshopMiniQr();
    parentQr();
    renumber();
    setupImageSwap();
    await loadScript('presenter.js');
    await loadScript('autocol.js');
    veil.remove();
    if (!state.current && state.db) say('目前是母版預覽（' + (mode === 'workshop' ? '工作坊版' : '入校版') + '）：按 S 可切換版本或選場次');
  }
  boot();
})();
