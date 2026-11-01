// Карта в стилі Google Maps: фон можна рухати й масштабувати (мишка, колесо, два пальці, кнопки + −),
// мітки-краплі й лінія маршруту лежать поверх і НЕ масштабуються — лише стоять у потрібних точках.
// Клік по мітці відкриває «бульбашку» з назвою і кнопкою переходу.

const MIN = 1, MAX = 3.5;

/** Звивиста лінія через точки: кожен відрізок — пологий S-вигин (середина вигину — точно посередині відрізка). */
function wavyPath(pts, sign) {
  const f = v => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const k = 0.16 * len * (i % 2 ? sign : -sign);          // наскільки вигинається
    const nx = -dy / len * k, ny = dx / len * k;
    d += ` C${f(ax + dx / 3 + nx)},${f(ay + dy / 3 + ny)} ${f(ax + 2 * dx / 3 - nx)},${f(ay + 2 * dy / 3 - ny)} ${f(bx)},${f(by)}`;
  }
  return d;
}

/**
 * @param {HTMLElement} root  контейнер (має розмір, напр. aspect-ratio 3/4)
 * @param {{image:string}} opts
 */
export function createMapView(root, { image }) {
  root.classList.add('gmap');
  root.innerHTML = `
    <div class="gmap__world"><img src="${image}" alt="" draggable="false"></div>
    <svg class="gmap__route" aria-hidden="true"></svg>
    <div class="gmap__layer"></div>
    <div class="gmap__total" hidden></div>
    <div class="gmap__ctrl">
      <button type="button" data-zoom="in" aria-label="Наблизити">+</button>
      <button type="button" data-zoom="out" aria-label="Віддалити">−</button>
      <button type="button" data-zoom="reset" aria-label="Уся карта"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>`;
  const world = root.querySelector('.gmap__world');
  const svg = root.querySelector('.gmap__route');
  const layer = root.querySelector('.gmap__layer');
  const total = root.querySelector('.gmap__total');

  let s = 1, tx = 0, ty = 0, W = 1, H = 1;
  let data = { markers: [], segments: [], total: '' };
  let openId = null, onOpen = () => {};
  let raf = 0;

  const toScreen = ([x, y]) => [tx + (x / 100) * W * s, ty + (y / 100) * H * s];
  const clamp = () => {
    s = Math.min(MAX, Math.max(MIN, s));
    tx = Math.min(0, Math.max(W * (1 - s), tx));
    ty = Math.min(0, Math.max(H * (1 - s), ty));
  };
  const zoomAt = (cx, cy, ns) => {
    const wx = (cx - tx) / s, wy = (cy - ty) / s;
    s = Math.min(MAX, Math.max(MIN, ns));
    tx = cx - wx * s; ty = cy - wy * s;
    clamp(); schedule();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function draw() {
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = data.segments.map((seg, i) => {
      const d = wavyPath(seg.points.map(toScreen), i % 2 ? 1 : -1);
      return `<path class="gmap__line${seg.done ? ' is-done' : ''}" d="${d}"/>`;
    }).join('');
    for (const el of layer.children) {
      const p = el.dataset.at && JSON.parse(el.dataset.at);
      if (!p) continue;
      const [x, y] = toScreen(p);
      if (el.classList.contains('gbubble')) {
        // бульбашка не виходить за краї карти: зсуваємо її, а «хвостик» лишається над міткою
        el.style.visibility = x < 0 || x > W || y < 0 || y > H ? 'hidden' : '';   // мітка за краєм — бульбашку ховаємо
        const half = el.offsetWidth / 2, lx = Math.min(Math.max(x, half + 6), W - half - 6);
        const below = y - 46 - el.offsetHeight < 4;
        el.classList.toggle('is-below', below);
        el.style.left = `${lx}px`; el.style.top = `${below ? y + 8 : y}px`;
        el.style.setProperty('--arrow', `${x - lx + half}px`);
        continue;
      }
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    }
  }

  function build() {
    const html = [];
    for (const seg of data.segments) {
      if (!seg.label) continue;
      const pts = seg.points, mid = pts[Math.floor((pts.length - 1) / 2)], nxt = pts[Math.floor((pts.length - 1) / 2) + 1] || mid;
      const at = [(mid[0] + nxt[0]) / 2, (mid[1] + nxt[1]) / 2];
      html.push(`<div class="gmap__time" data-at="${JSON.stringify(at)}">${seg.label}</div>`);
    }
    for (const m of data.markers) {
      html.push(`<button type="button" class="gpin gpin--${m.state}" data-id="${m.id}" data-at="${JSON.stringify([m.x, m.y])}"
        aria-label="${m.title}"><span class="gpin__head"><span class="gpin__in">${m.inner}</span></span></button>`);
    }
    const m = data.markers.find(x => String(x.id) === openId);
    if (m) {
      html.push(`<div class="gbubble" data-at="${JSON.stringify([m.x, m.y])}" role="dialog" aria-label="${m.title}">
        <button type="button" class="gbubble__close" data-close-bubble aria-label="Закрити">✕</button>${m.bubble}</div>`);
    }
    layer.innerHTML = html.join('');
    total.innerHTML = data.total;
    total.hidden = !data.total;
    draw();
  }

  // ---------- жести ----------
  const pointers = new Map();
  let moved = 0, last = null;
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.gpin, .gbubble, .gmap__ctrl')) return;
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
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    last = null;
    if (!pointers.size && moved < 6 && openId !== null) { openId = null; build(); } // клік по карті закриває бульбашку
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  root.addEventListener('dblclick', e => {
    if (e.target.closest('.gpin, .gbubble, .gmap__ctrl')) return;
    const r = root.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, s * 1.6);
  });
  root.addEventListener('click', e => {
    const z = e.target.closest('[data-zoom]');
    if (z) {
      if (z.dataset.zoom === 'reset') { s = 1; tx = 0; ty = 0; schedule(); return; }
      zoomAt(W / 2, H / 2, s * (z.dataset.zoom === 'in' ? 1.5 : 1 / 1.5));
      return;
    }
    if (e.target.closest('[data-close-bubble]')) { openId = null; build(); return; }
    const go = e.target.closest('[data-open]');
    if (go) { onOpen(go.dataset.open); return; }
    const pin = e.target.closest('.gpin');
    if (pin) {
      const id = pin.dataset.id;
      openId = openId === id ? null : id;
      build();
    }
  });

  new ResizeObserver(() => {
    const r = root.getBoundingClientRect();
    if (!r.width) return;
    const k = r.width / W;
    tx *= k; ty *= k; W = r.width; H = r.height;
    clamp(); draw();
  }).observe(root);

  return {
    /** markers: [{id,x,y,state:'done'|'current'|'locked'|'open',inner,title,bubble}], segments: [{points:[[x,y]…],done,label}] */
    setData(d, open) { data = d; onOpen = open || onOpen; build(); },
    /** Інший фон (екран локації): нова картинка і масштаб до початкового. */
    setImage(src) {
      const img = world.querySelector('img');
      if (img.getAttribute('src') !== src) { img.src = src; openId = null; s = 1; tx = 0; ty = 0; schedule(); }
    },
    closeBubble() { openId = null; build(); },
  };
}
