(() => {
  'use strict';

  // ---------- Constants ----------

  const STORE_KEY = 'wp-reader-v1';
  const SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 29, 32];
  const FONTS = {
    serif: "'Noto Serif KR', 'Nanum Myeongjo', 'AppleMyungjo', serif",
    batang: "'Gowun Batang', 'Noto Serif KR', serif",
    sans: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  };
  const MARGINS = { s: 14, m: 26, l: 44 };
  const THEME_COLORS = { white: '#ffffff', sepia: '#f5ecd9', green: '#d9ead3', black: '#0f0f0f' };
  const CHARS_PER_MIN = 550; // rough Korean reading speed
  const CHARS_PER_LOCATION = 150;

  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const viewport = $('#viewport');
  const content = $('#content');
  const ribbon = $('#ribbon');
  const runninghead = $('#runninghead');
  const statusLeft = $('#status-left');
  const statusRight = $('#status-right');
  const topbar = $('#topbar');
  const bottombar = $('#bottombar');
  const drawer = $('#drawer');
  const sheet = $('#sheet');
  const scrim = $('#scrim');
  const scrub = $('#scrub');
  const scrubLabel = $('#scrub-label');
  const toastEl = $('#toast');

  // ---------- Persistent state ----------

  const defaults = {
    settings: {
      size: window.innerWidth < 600 ? 4 : 5,
      font: 'serif',
      leading: '1.8',
      margin: 'm',
      theme: 'white',
      anim: 'slide',
    },
    pos: { ch: 0, top: true },
    marks: [],
    footMode: 0,
  };

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && typeof raw === 'object') {
        return {
          settings: { ...defaults.settings, ...raw.settings },
          pos: raw.pos && typeof raw.pos === 'object' ? raw.pos : { ...defaults.pos },
          marks: Array.isArray(raw.marks) ? raw.marks : [],
          footMode: Number(raw.footMode) || 0,
        };
      }
    } catch (e) { /* storage unavailable or corrupt */ }
    return JSON.parse(JSON.stringify(defaults));
  }
  const store = loadStore();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  // ---------- Book data ----------

  let toc = null;
  let chapters = []; // flat: { id, title, start, chars, book, bookIdx }
  const cache = new Map();

  function fetchChapter(id) {
    if (!cache.has(id)) {
      const p = fetch(`data/ch/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(`chapter ${id}: ${r.status}`);
        return r.json();
      });
      p.catch(() => cache.delete(id));
      cache.set(id, p);
    }
    return cache.get(id);
  }

  // ---------- Layout state for the open chapter ----------

  const cur = {
    ch: -1,
    page: 0,
    pages: 1,
    pageW: 0,
    paras: [],   // <p> elements
    starts: [],  // page each paragraph starts on
    ends: [],    // page each paragraph ends on
    paraChars: [],
  };
  const range = document.createRange();

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderChapter(data) {
    let html = '';
    if (data.id === 0) {
      html += `<div class="cover">
        <div class="a">레프 톨스토이</div>
        <div class="t">전쟁과 평화</div>
        <div class="a">현대어 번역</div>
        <div class="rule"></div>
        <div class="s">루이즈 &amp; 에일머 모드 영역본을 바탕으로 옮김</div>
      </div>`;
    }
    html += '<div class="ch-head">';
    if (data.bookStart) html += `<span class="book">${esc(data.book)}</span>`;
    if (data.title) html += `<span class="chap">${esc(data.title)}</span>`;
    html += '</div>';
    html += data.paras.map((p, i) => `<p data-i="${i}"${i === 0 ? ' class="first"' : ''}>${esc(p)}</p>`).join('');
    content.innerHTML = html;
    cur.paras = Array.from(content.querySelectorAll('p[data-i]'));
    let acc = 0;
    cur.paraChars = data.paras.map((p) => { const a = acc; acc += p.length; return a; });
  }

  function applyTypography() {
    const s = store.settings;
    content.style.fontSize = SIZES[s.size] + 'px';
    content.style.lineHeight = s.leading;
    document.documentElement.style.setProperty('--reading-font', FONTS[s.font] || FONTS.serif);
    document.body.dataset.theme = s.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLORS[s.theme] || '#ffffff';
  }

  // Lay the chapter out as CSS columns, one column per screen-width page,
  // then record which page every paragraph starts and ends on.
  function paginate() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const wide = vw > 640;
    const m = MARGINS[store.settings.margin] + (wide ? 24 : 0);
    const colW = vw - 2 * m;
    cur.pageW = vw;
    content.classList.remove('animate');
    Object.assign(content.style, {
      left: m + 'px',
      width: colW + 'px',
      height: vh + 'px',
      columnWidth: colW + 'px',
      columnGap: 2 * m + 'px',
      transform: 'translateX(0px)',
    });

    const base = content.getBoundingClientRect().left;
    const pageOf = (r) => Math.max(0, Math.floor((r.left - base + 2) / vw));
    cur.starts = [];
    cur.ends = [];
    let last = 0;
    for (const p of cur.paras) {
      range.selectNodeContents(p);
      const rects = range.getClientRects();
      const first = rects[0] || p.getBoundingClientRect();
      const end = rects[rects.length - 1] || first;
      cur.starts.push(pageOf(first));
      cur.ends.push(pageOf(end));
      last = Math.max(last, pageOf(end));
    }
    if (!cur.paras.length) {
      const r = content.lastElementChild && content.lastElementChild.getBoundingClientRect();
      if (r) last = pageOf(r);
    }
    cur.pages = last + 1;
  }

  function charPage(i, k) {
    const node = cur.paras[i].firstChild;
    if (!node) return cur.starts[i];
    const len = node.length;
    k = Math.max(0, Math.min(k, len - 1));
    range.setStart(node, k);
    range.setEnd(node, k + 1);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1] || range.getBoundingClientRect();
    // content and its text move together under the transform, so measure against content's live box
    const base = content.getBoundingClientRect().left;
    return Math.max(0, Math.floor((r.left - base + 2) / cur.pageW));
  }

  // The first character on a page is the reading position: it survives font, size and screen changes.
  function anchorAt(page) {
    if (page === 0) return { para: 0, off: 0, top: true };
    let i = cur.ends.findIndex((e) => e >= page);
    if (i < 0) i = cur.paras.length - 1;
    if (i < 0 || cur.starts[i] >= page) return { para: Math.max(i, 0), off: 0 };
    const len = cur.paras[i].firstChild ? cur.paras[i].firstChild.length : 0;
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (charPage(i, mid) >= page) hi = mid; else lo = mid + 1;
    }
    return { para: i, off: lo };
  }

  function pageFor(a) {
    if (!a || a.top) return 0;
    const i = Math.min(Math.max(a.para | 0, 0), cur.paras.length - 1);
    if (i < 0) return 0;
    if (!a.off) return cur.starts[i];
    return Math.min(charPage(i, a.off), cur.pages - 1);
  }

  // ---------- Showing pages ----------

  function setTranslate(px, animate) {
    content.classList.toggle('animate', !!animate && store.settings.anim === 'slide');
    content.style.transform = `translateX(${px}px)`;
  }

  function showPage(page, animate) {
    cur.page = Math.max(0, Math.min(page, cur.pages - 1));
    setTranslate(-cur.page * cur.pageW, animate);
    const a = anchorAt(cur.page);
    store.pos = { ch: cur.ch, ...a };
    save();
    updateStatus();
  }

  async function openChapter(ch, target = {}) {
    ch = Math.max(0, Math.min(ch, chapters.length - 1));
    let data;
    try {
      data = await fetchChapter(ch);
    } catch (e) {
      toast('장을 불러오지 못했습니다. 연결을 확인해 주세요.');
      return;
    }
    if (ch !== cur.ch) {
      if (target.fade) {
        viewport.style.transition = 'none';
        viewport.style.opacity = '0';
      }
      renderChapter(data);
      cur.ch = ch;
    }
    cur.page = 0;
    paginate();

    let page = 0;
    if (target.last) page = cur.pages - 1;
    else if (target.frac != null) page = Math.round(target.frac * (cur.pages - 1));
    else if (target.anchor) page = pageFor(target.anchor);
    showPage(page, false);

    if (target.fade) {
      requestAnimationFrame(() => {
        viewport.style.transition = 'opacity .18s';
        viewport.style.opacity = '1';
      });
    }
    if (ch + 1 < chapters.length) fetchChapter(ch + 1).catch(() => {});
    if (ch > 0) fetchChapter(ch - 1).catch(() => {});
  }

  function relayout() {
    if (cur.ch < 0) return;
    const a = store.pos.ch === cur.ch ? store.pos : anchorAt(cur.page);
    paginate();
    cur.page = 0;
    showPage(pageFor(a), false);
  }

  let busy = false;
  async function next() {
    if (busy) return;
    if (cur.page < cur.pages - 1) return showPage(cur.page + 1, true);
    if (cur.ch < chapters.length - 1) {
      busy = true;
      await openChapter(cur.ch + 1, { fade: true });
      busy = false;
    } else {
      setTranslate(-cur.page * cur.pageW, true);
      toast('책의 마지막 페이지입니다');
    }
  }

  async function prev() {
    if (busy) return;
    if (cur.page > 0) return showPage(cur.page - 1, true);
    if (cur.ch > 0) {
      busy = true;
      await openChapter(cur.ch - 1, { last: true, fade: true });
      busy = false;
    } else {
      setTranslate(0, true);
    }
  }

  // ---------- Progress and status ----------

  function globalChar() {
    const c = chapters[cur.ch];
    return c.start + c.chars * ((cur.page + 1) / cur.pages);
  }

  function percent() {
    return Math.floor((globalChar() / toc.totalChars) * 100);
  }

  function fmtTime(chars) {
    const min = Math.max(1, Math.round(chars / CHARS_PER_MIN));
    if (min < 60) return `${min}분`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }

  function updateStatus() {
    const c = chapters[cur.ch];
    const left = cur.pages - 1 - cur.page;
    const chLeftChars = c.chars * (left / cur.pages);
    const modes = [
      () => (left === 0 ? '장의 마지막 페이지' : `이 장에서 ${left}쪽 남음`),
      () => (left === 0 ? '장의 마지막 페이지' : `이 장 남은 시간 ${fmtTime(chLeftChars)}`),
      () => `책 남은 시간 ${fmtTime(toc.totalChars - globalChar())}`,
      () => `위치 ${Math.floor(globalChar() / CHARS_PER_LOCATION).toLocaleString()} / ${Math.ceil(toc.totalChars / CHARS_PER_LOCATION).toLocaleString()}`,
    ];
    statusLeft.textContent = modes[store.footMode % modes.length]();
    statusRight.textContent = `${percent()}%`;
    runninghead.textContent = `${c.book}${c.title ? ' · ' + c.title : ''}`;
    $('#topbar-sub').textContent = `${c.book} · ${c.title}`;
    $('#drawer-progress').textContent = `${percent()}% 읽음`;

    const v = Math.round((globalChar() / toc.totalChars) * 1000);
    scrub.value = v;
    scrub.style.setProperty('--p', v / 10 + '%');
    scrubLabel.textContent = `${c.title} · ${percent()}%`;

    const marked = currentMark() >= 0;
    ribbon.hidden = !marked;
    $('#btn-bookmark').classList.toggle('on', marked);
  }

  // ---------- Bookmarks ----------

  function currentMark() {
    return store.marks.findIndex((m) => m.ch === cur.ch && pageFor(m) === cur.page);
  }

  function toggleBookmark() {
    const idx = currentMark();
    if (idx >= 0) {
      store.marks.splice(idx, 1);
      toast('북마크를 지웠습니다');
    } else {
      const a = anchorAt(cur.page);
      const p = cur.paras[a.para];
      const text = p ? p.textContent.slice(a.off, a.off + 90) : '';
      store.marks.push({ ch: cur.ch, ...a, pct: percent(), snip: text, at: Date.now() });
      store.marks.sort((x, y) => x.ch - y.ch || x.para - y.para || x.off - y.off);
      toast('북마크를 추가했습니다');
    }
    save();
    updateStatus();
    renderMarks();
  }

  function renderMarks() {
    const list = $('#marks-list');
    if (!store.marks.length) {
      list.innerHTML = '<div class="empty">아직 북마크가 없습니다.<br>화면 가운데를 누른 뒤 위쪽 리본 아이콘으로 추가하세요.</div>';
      return;
    }
    list.innerHTML = store.marks.map((m, i) => {
      const c = chapters[m.ch];
      return `<div class="mark" data-i="${i}">
        <div class="txt">
          <div class="where">${esc(c.book)} · ${esc(c.title)} · ${m.pct}%</div>
          <div class="snip">${esc(m.snip || '')}</div>
        </div>
        <button class="del icon-btn small" data-del="${i}" type="button" aria-label="북마크 삭제">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  // ---------- Table of contents ----------

  function buildToc() {
    $('#toc-list').innerHTML = toc.books.map((b, bi) => `
      <details class="toc-book" data-b="${bi}">
        <summary><span>${esc(b.title)}</span><small>${b.chapters.length}장</small></summary>
        <div class="toc-chapters">
          ${b.chapters.map((c) => `<button type="button" class="toc-ch" data-ch="${c.id}">${esc(c.title.replace(/^제\s*/, '').replace(/장$/, '장'))}</button>`).join('')}
        </div>
      </details>`).join('');
  }

  function refreshToc() {
    const list = $('#toc-list');
    list.querySelectorAll('.toc-ch').forEach((el) => {
      const id = +el.dataset.ch;
      el.classList.toggle('current', id === cur.ch);
      el.classList.toggle('read', id < cur.ch);
    });
    const bi = chapters[cur.ch].bookIdx;
    list.querySelectorAll('.toc-book').forEach((d) => { d.open = +d.dataset.b === bi; });
    const el = list.querySelector('.toc-ch.current');
    if (el) el.closest('details').scrollIntoView({ block: 'start' });
  }

  // ---------- Panels ----------

  function setChrome(show) {
    topbar.hidden = !show;
    bottombar.hidden = !show;
  }
  const chromeOpen = () => !topbar.hidden;
  const panelOpen = () => !drawer.hidden || !sheet.hidden;

  function openDrawer(tab = 'toc') {
    setChrome(false);
    sheet.hidden = true;
    drawer.hidden = false;
    scrim.hidden = false;
    selectTab(tab);
    if (tab === 'toc') refreshToc();
  }

  function selectTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $('#toc-list').hidden = tab !== 'toc';
    $('#marks-list').hidden = tab !== 'marks';
    if (tab === 'marks') renderMarks();
  }

  function openSheet() {
    setChrome(false);
    drawer.hidden = true;
    sheet.hidden = false;
    scrim.hidden = false;
    scrim.style.background = 'transparent';
    syncSheet();
  }

  function closePanels() {
    drawer.hidden = true;
    sheet.hidden = true;
    scrim.hidden = true;
    scrim.style.background = '';
  }

  function syncSheet() {
    const s = store.settings;
    $('#size-dots').innerHTML = SIZES.map((_, i) => `<i class="${i <= s.size ? 'on' : ''}"></i>`).join('');
    $('#font-down').disabled = s.size <= 0;
    $('#font-up').disabled = s.size >= SIZES.length - 1;
    const mark = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    mark('seg-font', s.font);
    mark('seg-leading', s.leading);
    mark('seg-margin', s.margin);
    mark('seg-theme', s.theme);
    mark('seg-anim', s.anim);
  }

  function changeSetting(key, value) {
    store.settings[key] = value;
    save();
    applyTypography();
    syncSheet();
    if (key !== 'theme' && key !== 'anim') relayout();
  }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1600);
  }

  // ---------- Input ----------

  function isUi(target) {
    return !!target.closest('.chrome, #drawer, #sheet, #status, #scrim, #toast');
  }

  // Taps: left third goes back, right third goes forward, middle shows the toolbars.
  let suppressClick = false;
  app.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (isUi(e.target) || panelOpen()) return;
    if (chromeOpen()) { setChrome(false); return; }
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) prev();
    else if (x > 0.7) next();
    else setChrome(true);
  });

  // Swipes: the page follows the finger, then settles on the next, previous or same page.
  let touch = null;
  app.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || isUi(e.target) || panelOpen() || busy) { touch = null; return; }
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, horiz: null };
  }, { passive: true });

  app.addEventListener('touchmove', (e) => {
    if (!touch) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    if (touch.horiz === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) touch.horiz = Math.abs(dx) > Math.abs(dy);
    if (!touch.horiz) return;
    e.preventDefault();
    let d = dx;
    const atStart = cur.page === 0 && cur.ch === 0;
    const atEnd = cur.page === cur.pages - 1 && cur.ch === chapters.length - 1;
    if ((d > 0 && atStart) || (d < 0 && atEnd)) d *= 0.25;
    touch.dx = d;
    if (store.settings.anim === 'slide') setTranslate(-cur.page * cur.pageW + d, false);
  }, { passive: false });

  app.addEventListener('touchend', () => {
    if (!touch) return;
    const { dx, horiz, t } = touch;
    touch = null;
    if (!horiz) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (chromeOpen()) setChrome(false);
    const fast = Math.abs(dx) > 25 && Date.now() - t < 250;
    if (dx < -60 || (fast && dx < 0)) next();
    else if (dx > 60 || (fast && dx > 0)) prev();
    else setTranslate(-cur.page * cur.pageW, true);
  });

  app.addEventListener('touchcancel', () => {
    if (touch) setTranslate(-cur.page * cur.pageW, true);
    touch = null;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanels(); setChrome(false); return; }
    if (panelOpen() || e.target === scrub) return;
    if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) { e.preventDefault(); prev(); }
  });

  let wheelAcc = 0;
  let wheelLock = 0;
  app.addEventListener('wheel', (e) => {
    if (isUi(e.target) || panelOpen()) return;
    e.preventDefault();
    if (Date.now() < wheelLock) return;
    wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(wheelAcc) > 40) {
      wheelAcc > 0 ? next() : prev();
      wheelAcc = 0;
      wheelLock = Date.now() + 450;
    }
  }, { passive: false });

  $('#status').addEventListener('click', () => {
    store.footMode = (store.footMode + 1) % 4;
    save();
    updateStatus();
  });

  $('#btn-toc').addEventListener('click', () => openDrawer('toc'));
  $('#btn-settings').addEventListener('click', openSheet);
  $('#btn-bookmark').addEventListener('click', toggleBookmark);
  $('#btn-close-drawer').addEventListener('click', closePanels);
  scrim.addEventListener('click', closePanels);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  $('#toc-list').addEventListener('click', (e) => {
    const b = e.target.closest('.toc-ch');
    if (!b) return;
    closePanels();
    openChapter(+b.dataset.ch, { fade: true });
  });

  $('#marks-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      store.marks.splice(+del.dataset.del, 1);
      save();
      renderMarks();
      updateStatus();
      return;
    }
    const row = e.target.closest('.mark');
    if (!row) return;
    const m = store.marks[+row.dataset.i];
    closePanels();
    openChapter(m.ch, { anchor: m, fade: true });
  });

  $('#btn-prev-ch').addEventListener('click', () => openChapter(cur.page > 0 ? cur.ch : cur.ch - 1, { fade: true }));
  $('#btn-next-ch').addEventListener('click', () => { if (cur.ch < chapters.length - 1) openChapter(cur.ch + 1, { fade: true }); });

  function locate(v) {
    const g = (v / 1000) * toc.totalChars;
    let i = chapters.findIndex((c) => c.start + c.chars > g);
    if (i < 0) i = chapters.length - 1;
    const c = chapters[i];
    return { ch: i, frac: c.chars ? Math.min(1, Math.max(0, (g - c.start) / c.chars)) : 0 };
  }

  scrub.addEventListener('input', () => {
    const { ch } = locate(+scrub.value);
    const c = chapters[ch];
    scrub.style.setProperty('--p', scrub.value / 10 + '%');
    scrubLabel.textContent = `${c.book} · ${c.title} · ${Math.floor(scrub.value / 10)}%`;
  });
  scrub.addEventListener('change', () => {
    const { ch, frac } = locate(+scrub.value);
    openChapter(ch, { frac, fade: true });
  });

  $('#font-down').addEventListener('click', () => changeSetting('size', Math.max(0, store.settings.size - 1)));
  $('#font-up').addEventListener('click', () => changeSetting('size', Math.min(SIZES.length - 1, store.settings.size + 1)));
  const seg = (id, key) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) changeSetting(key, b.dataset.v);
  });
  seg('#seg-font', 'font');
  seg('#seg-leading', 'leading');
  seg('#seg-margin', 'margin');
  seg('#seg-theme', 'theme');
  seg('#seg-anim', 'anim');

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 150);
  });

  // Web fonts arrive in slices as new glyphs appear; re-measure when they do.
  if (document.fonts) {
    let fontTimer;
    document.fonts.addEventListener('loadingdone', () => {
      clearTimeout(fontTimer);
      fontTimer = setTimeout(relayout, 120);
    });
  }

  // ---------- Start ----------

  async function start() {
    applyTypography();
    try {
      const r = await fetch('data/toc.json');
      toc = await r.json();
    } catch (e) {
      $('#loading').textContent = '책을 불러오지 못했습니다. 새로고침해 주세요.';
      return;
    }
    toc.books.forEach((b, bi) => b.chapters.forEach((c) => chapters.push({ ...c, book: b.title, bookIdx: bi })));
    buildToc();
    const pos = store.pos;
    await openChapter(pos.ch || 0, { anchor: pos });
    $('#loading').classList.add('gone');
  }

  start();
})();
