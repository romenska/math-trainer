// Диплом: малюємо на canvas (персонажі зі спрайту, ім'я, за що, дата, ID, QR) і зберігаємо як PDF.
// PDF збираємо самі: одна сторінка A4 (альбомна) з картинкою JPEG — без сторонніх бібліотек.

import qrcode from './vendor/qrcode.mjs?v=4.08';
import { ASSETS } from './config.js?v=4.08';

const W = 2339, H = 1654;           // A4 альбомна, ~200 dpi
const GOLD = '#d9962b', GOLD_DARK = '#a8691a', INK = '#3b2f2a', MUTED = '#8a7b70';
const FUN = '"Comfortaa", system-ui, sans-serif';
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const loadImg = src => new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i); i.onerror = fail; i.src = src;
});

/** Посилання на сторінку статистики учня (поруч із тренажером). */
export const statsUrl = code => new URL(`stats.html?c=${encodeURIComponent(code)}`, location.href).href;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function star(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

/** Текст у рядок заданої ширини: зменшуємо шрифт, доки не влізе. */
function fitText(ctx, text, x, y, maxW, size, font, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${font}`; s -= 4; } while (ctx.measureText(text).width > maxW && s > 20);
  ctx.fillText(text, x, y);
}

/** Перенесення тексту на кілька рядків по центру. Повертає y під останнім рядком. */
function wrapText(ctx, text, cx, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, cx, y); y += lineH; line = w; } else line = test;
  }
  if (line) { ctx.fillText(line, cx, y); y += lineH; }
  return y;
}

/** Вирізати персонажа з білого фону: світлі пікселі стають прозорими (м'який перехід по краю). */
function cutout(img, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const x = c.getContext('2d');
  x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const d = x.getImageData(0, 0, sw, sh), a = d.data;
  // заливка від країв: прибираємо лише фон і тінь на «підлозі», а не білі частини самого персонажа
  const isBg = i => { const m = Math.min(a[i], a[i + 1], a[i + 2]); return m > 190 && Math.max(a[i], a[i + 1], a[i + 2]) - m < 26; };
  const seen = new Uint8Array(sw * sh), stack = [];
  for (let px = 0; px < sw; px++) stack.push(px, (sh - 1) * sw + px);
  for (let py = 0; py < sh; py++) stack.push(py * sw, py * sw + sw - 1);
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || !isBg(k * 4)) continue;
    seen[k] = 1;
    const m = Math.min(a[k * 4], a[k * 4 + 1], a[k * 4 + 2]);
    a[k * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (232 - m) / 42)));   // тінь — напівпрозора
    const px = k % sw;
    if (px > 0) stack.push(k - 1);
    if (px < sw - 1) stack.push(k + 1);
    if (k >= sw) stack.push(k - sw);
    if (k < sw * (sh - 1)) stack.push(k + sw);
  }
  x.putImageData(d, 0, 0);
  return c;
}

function drawQR(ctx, text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
  ctx.fillStyle = '#fff';
  roundRect(ctx, x - 14, y - 14, size + 28, size + 28, 24); ctx.fill();
  ctx.fillStyle = INK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
  }
}

/**
 * @param {{heading?:string, name:string, title:string, subtitle:string, stats?:{label:string,value:string,note?:string}[], heroes:number[], date:string, code:string}} d
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawDiploma(d) {
  try { await Promise.all([document.fonts.load(`700 100px Comfortaa`), document.fonts.load(`600 40px Comfortaa`)]); } catch { /* без шрифту — системний */ }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // фон і рамки
  const bg = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, W * 0.7);
  bg.addColorStop(0, '#fffdf6'); bg.addColorStop(1, '#fdf0d2');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 18; roundRect(ctx, 60, 60, W - 120, H - 120, 60); ctx.stroke();
  ctx.strokeStyle = '#f0c873'; ctx.lineWidth = 5; roundRect(ctx, 100, 100, W - 200, H - 200, 44); ctx.stroke();
  for (const [x, y] of [[100, 100], [W - 100, 100], [100, H - 100], [W - 100, H - 100]]) star(ctx, x, y, 42, GOLD);
  // конфеті-зірочки
  const sparks = [[300, 420, '#ffcf5a'], [W - 300, 430, '#ff9aa8'], [250, 900, '#8fd3ff'], [W - 260, 880, '#9fe08a'], [420, 1250, '#ff9aa8'], [W - 430, 1240, '#ffcf5a']];
  for (const [x, y, c] of sparks) star(ctx, x, y, 22, c);

  // персонажі уроку зверху (0 — сонечко, 1–9 — герої-цифри зі спрайту)
  try {
    const [tiles, sun] = await Promise.all([loadImg(`${ASSETS.tiles}?v=4.08`), loadImg(`${ASSETS.zero}?v=4.08`)]);
    const T = tiles.naturalWidth / 9;
    const heroes = d.heroes?.length ? d.heroes : [3, 2, 0, 6, 8];
    const size = heroes.length <= 2 ? 300 : heroes.length === 3 ? 280 : 250, gap = 60;
    const total = heroes.length * size + (heroes.length - 1) * gap, mid = (heroes.length - 1) / 2;
    heroes.forEach((h, i) => {
      const x = (W - total) / 2 + i * (size + gap);
      const y = 130 + Math.abs(i - mid) * 26;                           // легка дуга
      const pic = h === 0 ? cutout(sun, 0, 0, sun.naturalWidth, sun.naturalHeight) : cutout(tiles, (h - 1) * T, 0, T, T);
      ctx.drawImage(pic, x, y, size, size);
    });
  } catch { /* без картинок — лише текст */ }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

  // ДИПЛОМ
  const g = ctx.createLinearGradient(0, 460, 0, 580);
  g.addColorStop(0, '#f2b33d'); g.addColorStop(1, GOLD_DARK);
  ctx.font = `700 140px ${FUN}`;
  ctx.letterSpacing = '24px';
  ctx.fillStyle = g; ctx.fillText(d.heading || 'ДИПЛОМ', W / 2 + 12, 575);
  ctx.letterSpacing = '0px';

  // ім'я — найбільше
  ctx.fillStyle = INK;
  fitText(ctx, d.name, W / 2, 800, W - 700, 150, FUN);
  ctx.strokeStyle = '#f0c873'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2 - 480, 860); ctx.lineTo(W / 2 + 480, 860); ctx.stroke();

  // за що: «Марафон „Драконова бухта“», нижче дрібніше — урок
  ctx.fillStyle = INK;
  const withStats = Boolean(d.stats?.length);
  fitText(ctx, d.title, W / 2, withStats ? 975 : 1010, W - 700, 76, FUN);
  ctx.fillStyle = MUTED;
  fitText(ctx, d.subtitle, W / 2, withStats ? 1045 : 1090, W - 800, 46, FUN, 600);

  // результати — плашки: підпис, велике значення, пояснення дрібно
  const stats = d.stats || [];
  const pw = stats.length > 2 ? 440 : 560, ph = 200, pg = 36, px0 = (W - (stats.length * pw + (stats.length - 1) * pg)) / 2;
  stats.forEach((st, i) => {
    const x = px0 + i * (pw + pg), y = 1085;
    ctx.fillStyle = '#fff4d6'; roundRect(ctx, x, y, pw, ph, 36); ctx.fill();
    ctx.strokeStyle = '#f0c873'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = MUTED; ctx.font = `600 34px ${FUN}`; ctx.fillText(st.label, x + pw / 2, y + 54);
    ctx.fillStyle = GOLD_DARK; ctx.font = `700 80px ${FUN}`; ctx.fillText(st.value, x + pw / 2, y + 138);
    if (st.note) { ctx.fillStyle = MUTED; ctx.font = `600 28px ${FUN}`; ctx.fillText(st.note, x + pw / 2, y + 184); }
  });

  // низ: дата ліворуч; QR праворуч, під ним ID
  const qrSize = 230, qrX = W - 210 - qrSize, qrY = H - 200 - qrSize - 40;
  drawQR(ctx, statsUrl(d.code), qrX, qrY, qrSize);
  ctx.fillStyle = MUTED; ctx.textAlign = 'center';
  ctx.font = `500 26px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillText(`код ${d.code}`, qrX + qrSize / 2, qrY + qrSize + 58);

  ctx.textAlign = 'left';
  ctx.fillStyle = INK; ctx.font = `700 46px ${FUN}`;
  ctx.fillText(d.date, 220, qrY + qrSize - 10);
  ctx.fillStyle = MUTED; ctx.font = `500 30px ${BODY}`;
  let footY = qrY + qrSize + 45;
  if (d.time) { ctx.font = `600 32px ${FUN}`; ctx.fillText(d.time, 220, footY); footY += 50; ctx.font = `500 30px ${BODY}`; }
  ctx.fillText('Тренажер множення', 220, footY);
  return cv;
}

/** Canvas → PDF (A4 альбомна, картинка на всю сторінку). */
export async function canvasToPdf(canvas) {
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.92));
  const jpg = new Uint8Array(await blob.arrayBuffer());
  const PW = 842, PH = 595, enc = new TextEncoder();
  const parts = [], offsets = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg); push('\nendstream');
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------- Готові нагороди: диплом уроку і сертифікат екзамену ----------
const fmtTime = secs => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
const longDate = date => date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

/** Дата з запису «dd.mm.yyyy HH:MM» → Date (або null). */
export function parseRecordDate(s) {
  const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
}

/** Диплом за пройдений урок. date — Date. */
export function lessonDiploma({ name, lesson, date, code }) {
  return drawDiploma({ name, title: `«${lesson.place.name}»`, subtitle: lesson.name, heroes: lesson.factors,
    date: longDate(date), code });
}

/** Сертифікат про складання екзамену. rec — запис екзамену {correct, totalQuestions, time}. */
export function examCertificate({ name, rec, date, code }) {
  const pct = rec.totalQuestions ? Math.round((Number(rec.correct) || 0) / rec.totalQuestions * 100) : 0;
  const time = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return drawDiploma({
    heading: 'СЕРТИФІКАТ', name,
    title: 'про складання екзамену з курсу «Множення»', subtitle: 'уся таблиця множення: від 1×1 до 9×9',
    heroes: [2, 6, 8],
    stats: [
      { label: 'правильних відповідей', value: `${pct}%`, note: `${Number(rec.correct) || 0} з ${rec.totalQuestions}` },
      { label: 'тривалість', value: fmtTime(Number(rec.time) || 0), note: 'хвилин : секунд' },
    ],
    date: longDate(date), time, code,
  });
}

/** Зберегти canvas як PDF-файл. */
export async function downloadPdf(canvas, fileName) {
  const blob = await canvasToPdf(canvas);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
