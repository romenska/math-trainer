// Одна велика карта гри: картинки уроків стоять одна за одною зліва направо (смуга).
// Екран вертикальний, тому кожна картинка уроку теж вертикальна — 2:3 (1000×1500 «світових» одиниць;
// розмір — у course.json → map.panel). Вхід в урок — посередині лівого краю, дорожка в'ється вгору-вниз
// через усі тренування і виходить посередині правого краю — у вхід наступного уроку.
//
// Карта сіра (чорно-біла); кольоровими стають: вхід відкритого уроку, пройдені тренування,
// поточне тренування (пульсує), а пройдений урок — повністю. Чорно-білу версію робить сам браузер
// із кольорової картинки, тому вони завжди збігаються до пікселя.
//
// Карту можна рухати й масштабувати (пальці, мишка, колесо, кнопки + −), кнопка-приціл — «де я».
// Мітки не масштабуються. Клік по мітці відкриває вікно по центру екрана.

let PW = 1000, PH = 1500;   // розмір картинки уроку у «світових» одиницях

/** Кольорова картинка є? Пробуємо завантажити один раз; немає — береться намальована заглушка. */
const probed = new Map();
function probe(src) {
  if (!probed.has(src)) {
    probed.set(src, new Promise(res => {
      const img = new Image();
      img.onload = () => res(true);
      img.onerror = () => res(false);
      img.src = src;
    }));
  }
  return probed.get(src);
}

/**
 * @param {HTMLElement} root
 * @returns {{ setData(d, onPick), focus(markerId, zoom?), closeDialog() }}
 */
export function createWorldMap(root, { panel, gap } = {}) {
  if (panel?.width && panel?.height) { PW = panel.width; PH = panel.height; }
  // проміжок між картинками уроків: тут гра сама малює перехід (дорожку, місток, ворота)
  // від виходу одного уроку до входу наступного — картинкам не треба збігатися на стику
  const GAP = Number.isFinite(gap) ? gap : Math.round(PW * 0.25);
  root.classList.add('gmap', 'wmap');
  root.innerHTML = `
    <div class="gmap__world wmap__world"></div>
    <div class="gmap__layer"></div>
    <div class="gmap__total" hidden></div>
    <div class="gmap__ctrl">
      <button type="button" data-zoom="me" class="gmap__me" aria-label="Де я" title="Де я"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      <button type="button" data-zoom="in" aria-label="Наблизити">+</button>
      <button type="button" data-zoom="out" aria-label="Віддалити">−</button>
      <button type="button" data-zoom="reset" aria-label="Початковий масштаб" title="Початковий масштаб"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div class="wdlg" hidden><div class="wdlg__card gbubble" role="dialog" aria-modal="true"></div></div>`;
  const world = root.querySelector('.wmap__world');
  const layer = root.querySelector('.gmap__layer');
  const total = root.querySelector('.gmap__total');
  const dlg = root.querySelector('.wdlg');
  const card = root.querySelector('.wdlg__card');

  let s = 1, tx = 0, ty = 0, W = 1, H = 1;          // масштаб, зсув, розмір вікна карти
  let data = { panels: [], markers: [], total: '' };
  let onPick = () => {};
  let raf = 0, fitted = false;
  const N = () => Math.max(1, data.panels.length);
  // seamless: картинка уроку продовжує попередню без проміжку (згенеровані разом — дорожка вже з'єднана)
  const gapBefore = i => (i > 0 && !data.panels[i]?.seamless ? GAP : 0);
  const WW = () => panelLeft(N() - 1) + PW;                      // ширина світу
  const minS = () => H / PH;                                     // менше не віддаляємо: карта завжди на всю висоту, без порожнечі зверху й знизу
  const baseS = () => H / PH;                                    // картинка на всю висоту екрана
  const maxS = () => baseS() * 3.5;
  function panelLeft(i) { let x = 0; for (let k = 1; k <= i; k++) x += PW + gapBefore(k); return x; }   // урок 1 — ліворуч

  const worldPt = m => [panelLeft(m.panel) + (m.x / 100) * PW, (m.y / 100) * PH];
  const toScreen = ([x, y]) => [tx + x * s, ty + y * s];

  function clamp() {
    s = Math.min(maxS(), Math.max(minS(), s));
    const w = WW() * s, h = PH * s;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    ty = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, ty));
  }
  const zoomAt = (cx, cy, ns) => {
    const wx = (cx - tx) / s, wy = (cy - ty) / s;
    s = Math.min(maxS(), Math.max(minS(), ns));
    tx = cx - wx * s; ty = cy - wy * s;
    clamp(); schedule();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function draw() {
    world.style.width = `${WW()}px`;
    world.style.height = `${PH}px`;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    // віддалили карту — мітки зменшуються (до половини), щоб не налазили одна на одну
    layer.style.setProperty('--pin', Math.min(1, Math.max(0.45, s / baseS())).toFixed(3));
    for (const el of layer.children) {
      const p = el.dataset.at && JSON.parse(el.dataset.at);
      if (!p) continue;
      const [x, y] = toScreen(p);
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    }
  }

  /** Картинки уроків: сіра основа + кольорові «плями» (вхід, пройдені, поточне) або повністю кольорова. */
  async function buildPanels() {
    const srcs = await Promise.all(data.panels.map(async p => (p.src && await probe(p.src) ? p.src : p.fallback())));
    world.innerHTML = data.panels.map((p, i) => {
      const src = srcs[i];
      const spots = p.state === 'done' ? '' : p.reveal.map(r => {
        const R = r.r || 120, x = (r.x / 100) * PW, y = (r.y / 100) * PH;
        return `<div class="wspot${r.current ? ' is-current' : ''}" style="left:${x - R}px;top:${y - R}px;width:${2 * R}px;height:${2 * R}px;
          background-image:url(&quot;${src}&quot;);background-size:${PW}px ${PH}px;background-position:${R - x}px ${R - y}px"></div>`;
      }).join('');
      const seam = `${p.seamless ? ' wpanel--seam-l' : ''}${data.panels[i + 1]?.seamless ? ' wpanel--seam-r' : ''}`;
      return `<div class="wpanel wpanel--${p.state}${seam}" style="left:${panelLeft(i)}px;width:${PW}px;height:${PH}px">
        <img class="wpanel__img" src="${src}" alt="" draggable="false">${spots}</div>`;
    }).join('') + links() + routes();
  }

  /** Лінія маршруту доріжками (panel.route — відрізки, routeDone — які вже пройдено):
   *  майбутній шлях — напівпрозора смужка, пройдений — суцільна синя. */
  function routes() {
    const segs = data.panels.flatMap((p, i) => (p.route || []).map((seg, k) => {
      const d = seg.map(([x, y], j) => `${j ? 'L' : 'M'}${(panelLeft(i) + (x / 100) * PW).toFixed(1)},${((y / 100) * PH).toFixed(1)}`).join('');
      return { d, done: Boolean(p.routeDone?.[k]) };
    }));
    if (!segs.length) return '';
    return `<svg class="wroute" width="${WW()}" height="${PH}" viewBox="0 0 ${WW()} ${PH}" aria-hidden="true">
      ${segs.filter(x => !x.done).map(x => `<path class="wroute__next" d="${x.d}"/>`).join('')}
      ${segs.filter(x => x.done).map(x => `<path class="wroute__done" d="${x.d}"/>`).join('')}</svg>`;
  }

  /** Стрілочки напрямку вздовж доріжок (place.arrows: [x%, y%, кут°]) — від тренування до тренування. */
  function arrows() {
    const marks = data.panels.flatMap((p, i) => (p.arrows || []).map(([x, y, a]) =>
      `<g class="warrow" transform="translate(${(panelLeft(i) + (x / 100) * PW).toFixed(1)} ${((y / 100) * PH).toFixed(1)}) rotate(${a})"><path d="M-13,-15 L10,0 L-13,15 L-6,0 Z"/></g>`));
    return marks.length ? `<svg class="warrows" width="${WW()}" height="${PH}" viewBox="0 0 ${WW()} ${PH}" aria-hidden="true">${marks.join('')}</svg>` : '';
  }

  /** Переходи між уроками: від точки виходу (out) картинки i до точки входу (entry) картинки i+1. */
  function links() {
    const pt = (i, [x, y]) => [panelLeft(i) + (x / 100) * PW, (y / 100) * PH];
    const paths = data.panels.slice(0, -1).map((p, i) => {
      const next = data.panels[i + 1];
      if (next.seamless) return '';                                   // перехід уже намальований на картинках
      const [x1, y1] = pt(i, p.out || [100, 50]), [x2, y2] = pt(i + 1, next.entry || [0, 50]);
      const dx = Math.max(GAP, x2 - x1) * 0.55;
      const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      const kind = next.link || 'road', on = next.state !== 'locked';
      return `<g class="wlink wlink--${kind}${on ? ' is-open' : ''}">${kind === 'bridge'
        ? `<path d="${d}" class="wlink__rail"/><path d="${d}" class="wlink__deck"/><path d="${d}" class="wlink__planks"/>`
        : `<path d="${d}" class="wlink__road"/><path d="${d}" class="wlink__dash"/>`}</g>`;
    }).join('');
    return `<svg class="wlinks" width="${WW()}" height="${PH}" viewBox="0 0 ${WW()} ${PH}" aria-hidden="true">${paths}</svg>`;
  }

  function buildMarkers() {
    layer.innerHTML = data.markers.map(m => `<button type="button" class="gpin gpin--${m.state}${m.gate ? ' gpin--gate' : ''}" data-id="${m.id}"
      data-at="${JSON.stringify(worldPt(m))}" aria-label="${m.title}"><span class="gpin__head"><span class="gpin__in">${m.inner}</span></span>
      ${m.label ? `<span class="gpin__label">${m.label}</span>` : ''}</button>`).join('');
    total.innerHTML = data.total;
    total.hidden = !data.total;
  }

  function openDialog(id) {
    const m = data.markers.find(x => String(x.id) === String(id));
    if (!m) return;
    card.setAttribute('aria-label', m.title);
    card.innerHTML = `<button type="button" class="gbubble__close" data-close-dlg aria-label="Закрити">✕</button>${m.dialog}`;
    dlg.hidden = false;
    card.querySelector('[data-open]')?.focus({ preventScroll: true });
  }
  function closeDialog() { dlg.hidden = true; card.innerHTML = ''; }

  // ---------- жести ----------
  const pointers = new Map();
  let moved = 0, last = null;
  root.addEventListener('pointerdown', e => {
    if (!pointers.size) moved = 0;                 // новий дотик: попереднє перетягування не рахується
    if (e.target.closest('.gpin, .wdlg, .gmap__ctrl')) return;
    root.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = 0; last = null;
  });
  root.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const r = root.getBoundingClientRect();
    if (pointers.size === 1) {
      tx += e.clientX - prev[0]; ty += e.clientY - prev[1];
      moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
      clamp(); schedule();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top];
      if (last) {
        tx += mid[0] - last.mid[0]; ty += mid[1] - last.mid[1];
        zoomAt(mid[0], mid[1], s * (dist / last.dist));
      }
      last = { dist, mid };
      moved += 10;
    }
  });
  const up = e => { if (pointers.delete(e.pointerId)) last = null; };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('wheel', e => {
    if (!dlg.hidden) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {                                   // щипок на тачпаді / Ctrl+колесо — масштаб
      zoomAt(e.clientX - r.left, e.clientY - r.top, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    } else {                                                        // колесо / тачпад — рух карти вздовж маршруту
      const k = e.deltaMode === 1 ? 32 : 1;                      // колесо вниз — карта йде вперед (праворуч)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) tx -= e.deltaX * k; else tx -= e.deltaY * k;
      clamp(); schedule();
    }
  }, { passive: false });
  root.addEventListener('dblclick', e => {
    if (e.target.closest('.gpin, .wdlg, .gmap__ctrl')) return;
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, s * 1.6);
  });
  root.addEventListener('click', e => {
    const z = e.target.closest('[data-zoom]');
    if (z) {
      if (z.dataset.zoom === 'reset') { s = minS(); clamp(); schedule(); return; }
      if (z.dataset.zoom === 'me') { focus(data.focus); return; }       // «де я» — до поточного тренування
      zoomAt(W / 2, H / 2, s * (z.dataset.zoom === 'in' ? 1.5 : 1 / 1.5));
      return;
    }
    if (e.target.closest('[data-close-dlg]') || e.target === dlg) { closeDialog(); return; }
    const go = e.target.closest('[data-open]');
    if (go) { closeDialog(); onPick(go.dataset.open); return; }
    const pin = e.target.closest('.gpin');
    if (pin && moved < 6) openDialog(pin.dataset.id);
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && !dlg.hidden) closeDialog(); });

  /** Показати мітку посередині екрана (на початку — поточне тренування). */
  function focus(id, zoom = baseS()) {
    const m = data.markers.find(x => String(x.id) === String(id));
    s = zoom;
    if (m) { const [x, y] = worldPt(m); tx = W / 2 - x * s; ty = H / 2 - y * s; }
    clamp(); schedule();
  }

  new ResizeObserver(() => {
    const r = root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = (W / 2 - tx) / s, cy = (H / 2 - ty) / s, rel = s / baseS();
    W = r.width; H = r.height;
    if (!fitted) { fitted = true; focus(data.focus); return; }
    s = baseS() * rel; tx = W / 2 - cx * s; ty = H / 2 - cy * s;   // поворот екрана: той самий центр і наближення
    clamp(); draw();
  }).observe(root);

  return {
    /**
     * panels:  [{ src, fallback(): url, state: 'locked'|'open'|'done', reveal: [{x,y,r,current}] }]
     * markers: [{ id, panel, x, y, state, inner, title, dialog, gate?, label? }] — x, y у % картинки уроку
     */
    setData(d, pick) {
      const first = !data.panels.length;
      data = d; onPick = pick || onPick;
      buildPanels(); buildMarkers();
      if (first && W > 1) focus(d.focus); else { clamp(); draw(); }
    },
    focus,
    closeDialog,
  };
}

// ---------- Заглушка, поки немає намальованої картинки уроку ----------
// Простий план місцевості в кольорах теми: дорожка від входу (ліворуч посередині) через усі
// тренування до виходу (праворуч посередині), галявини-«локації» і перехід (міст / ворота).

const THEMES = {
  bay:    { ground: '#f4e1ad', water: '#7cc8ef', grass: '#a6dc8a', accent: '#f08a5d' },
  island: { ground: '#a9e08f', water: '#6fbfe9', grass: '#bfe9a6', accent: '#ff8fc0' },
  farm:   { ground: '#c7e59a', water: '#8ccdf0', grass: '#9fd47a', accent: '#d9a25f' },
  castle: { ground: '#c9d8ff', water: '#8fb8f0', grass: '#b5e3a0', accent: '#9a7ff0' },
  finish: { ground: '#ffe8a8', water: '#9fd2f2', grass: '#bfe6a0', accent: '#f6b13b' },
};

/** Плавна крива через точки (Catmull-Rom → Безьє). */
function smoothPath(pts) {
  const f = v => v.toFixed(0);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/** SVG-заглушка картинки уроку (вертикальна, PW×PH) → data: URL. spots — точки тренувань у %.
 *  Вхід — посередині лівого краю, вихід — посередині правого. */
export function placeholderPanel({ theme = 'bay', title = '', spots = [], entry = 'gate', exit = 'gate' }) {
  const t = THEMES[theme] || THEMES.bay;
  const W = PW, H = PH, cy = H / 2;
  const P = spots.map(([x, y]) => [x / 100 * W, y / 100 * H]);
  const road = smoothPath([[0, cy], [70, cy], ...P, ...(exit === 'none' ? [] : [[W - 70, cy], [W, cy]])]);
  const bg = {
    bay: `<rect width="${W}" height="${H}" fill="${t.grass}"/><path d="M0 ${H}V${H * .74}C${W * .3} ${H * .7} ${W * .6} ${H * .8} ${W} ${H * .72}V${H}Z" fill="${t.ground}"/>
      <path d="M0 ${H}V${H * .86}C${W * .35} ${H * .82} ${W * .65} ${H * .92} ${W} ${H * .85}V${H}Z" fill="${t.water}"/>
      <rect x="${W * .8}" y="${H * .06}" width="44" height="150" rx="10" fill="#fff"/><rect x="${W * .8}" y="${H * .06 + 40}" width="44" height="26" fill="${t.accent}"/><rect x="${W * .8}" y="${H * .06 + 100}" width="44" height="26" fill="${t.accent}"/>`,
    island: `<rect width="${W}" height="${H}" fill="${t.water}"/><ellipse cx="${W / 2}" cy="${cy}" rx="${W * .4}" ry="${H * .44}" fill="${t.ground}"/><ellipse cx="${W / 2}" cy="${cy}" rx="${W * .34}" ry="${H * .39}" fill="${t.grass}"/>`,
    farm: `<rect width="${W}" height="${H}" fill="${t.ground}"/>${[0, 1, 2, 3, 4].map(i => `<rect x="${i % 2 ? W * .6 : W * .12}" y="${H * .06 + i * H * .18}" width="${W * .28}" height="${H * .1}" rx="18" fill="${t.grass}" opacity=".85"/>`).join('')}
      <path d="M50 0V${cy - 90}M50 ${cy + 90}V${H}" stroke="${t.accent}" stroke-width="14" stroke-dasharray="40 18"/>`,
    castle: `<rect width="${W}" height="${H}" fill="${t.grass}"/><path d="M0 0H${W}V${H * .12}C${W * .7} ${H * .16} ${W * .3} ${H * .08} 0 ${H * .14}Z" fill="${t.ground}"/>
      <path d="M40 0V${cy - 90}M40 ${cy + 90}V${H}" stroke="#9aa3c7" stroke-width="40"/><rect x="${W * .62}" y="${H * .02}" width="240" height="170" rx="10" fill="#e8e6ff"/>`,
    finish: `<rect width="${W}" height="${H}" fill="${t.grass}"/><rect x="${W * .1}" y="${H * .08}" width="${W * .8}" height="${H * .84}" rx="60" fill="${t.ground}"/>
      ${Array.from({ length: 10 }, (_, i) => `<rect x="${W * .86 + (i % 2) * 40}" y="${cy - 200 + i * 40}" width="40" height="40" fill="#333"/>`).join('')}`,
  }[theme] || '';
  // місток / ворота: side 'l' — лівий край (вхід), 'r' — правий (вихід)
  const bridge = side => { const x = side === 'l' ? 0 : W - 170; return `<rect x="${x}" y="${cy - 48}" width="170" height="96" rx="12" fill="#c9965c"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${x + 8 + i * 27}" y="${cy - 48}" width="12" height="96" fill="#a8743f"/>`).join('')}`; };
  const gate = side => { const x = side === 'l' ? 30 : W - 30; return `<path d="M${x} ${cy + 90}H${x}M${x} ${cy - 90}V${cy + 90}" stroke="${t.accent}" stroke-width="18"/><path d="M${x - 20} ${cy - 110}h40M${x - 20} ${cy + 110}h40" stroke="#6b5338" stroke-width="16" stroke-linecap="round"/>`; };
  const edge = (kind, side) => (kind === 'bridge' ? bridge(side) : kind === 'gate' ? gate(side) : '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bg}
    <path d="${road}" fill="none" stroke="#e9cf9a" stroke-width="64" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="#fff6dc" stroke-width="10" stroke-dasharray="26 30" stroke-linecap="round"/>
    ${edge(entry, 'l')}${edge(exit, 'r')}
    ${P.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="80" fill="#fff" opacity=".55"/><circle cx="${x}" cy="${y}" r="80" fill="none" stroke="${t.accent}" stroke-width="8" stroke-dasharray="14 12"/>`).join('')}
    <text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-family="Comfortaa, system-ui, sans-serif" font-weight="700" font-size="42" fill="#3b3b3b" opacity=".6">${title}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Точки тренувань за замовчуванням: «змійкою» по трьох смугах — угору ліворуч, униз посередині,
 *  угору праворуч; точки рівномірно вздовж дорожки, від входу (ліворуч) до виходу (праворуч). */
export function defaultSpots(n) {
  const path = [[22, 76], [22, 24], [50, 24], [50, 76], [78, 76], [78, 24]];
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], (p[1] - path[i][1]) * 1.5));
  const total = seg.reduce((x, y) => x + y, 0);
  return Array.from({ length: n }, (_, k) => {
    let d = n === 1 ? total / 2 : (total * k) / (n - 1), i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const t = Math.min(1, d / seg[i]), [a, b] = [path[i], path[i + 1]];
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)];
  });
}
