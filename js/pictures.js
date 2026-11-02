// Картинки таблиці множення: що на якій клітинці і як збирати завдання з картинок.
//
// Спрайт — таблиця 9×9: перший рядок/стовпчик — картинки ЧИСЕЛ (1 — маяк, 2 — дракон, …, 9 — глобус),
// клітинка на перетині (r, c) — картинка-асоціація ДОБУТКУ. Нуль — сонечко.
// Таблиця симетрична, і добутки з множниками ≥ 2 мають спільну картинку (2×6 і 3×4 — крокодил з вудкою).
// А от «число 6» (1×6, равлик) і «добуток 2×3» (свисток) — різні картинки. Тому порівнюємо не числа, а картинки.

import { shuffle } from './engine.js?v=3.92';

/** Ідентифікатор картинки клітинки (r, c). */
export function pictureId(r, c) {
  if (r * c === 0) return 'zero';
  if (r === 1 || c === 1) return `n${r * c}`; // картинка числа
  return `p${r * c}`;                          // картинка добутку
}

/** Усі різні значення добутків таблиці (для списку «обрати число»). */
export const PRODUCTS = [...new Set(Array.from({ length: 100 }, (_, i) => Math.floor(i / 10) * (i % 10)))].sort((x, y) => x - y);

/** Три потрібні картинки: рядок (a), стовпчик (b), перетин (a×b). */
export function neededPieces(q) {
  return [
    { r: q.a, c: 1, pid: pictureId(q.a, 1) },
    { r: 1, c: q.b, pid: pictureId(1, q.b) },
    { r: q.a, c: q.b, pid: pictureId(q.a, q.b) },
  ];
}

/**
 * Набір картинок для «Пригадай»: 3 правильні + зайві.
 * Зайві підбираються як типові пастки: картинка ЧИСЛА добутку замість картинки перетину,
 * сусідні клітинки таблиці, картинки сусідніх чисел.
 */
export function recallBank(q, size = 8, rng = Math.random) {
  const need = neededPieces(q);
  const used = new Set(need.map(p => p.pid));
  const p = q.a * q.b;
  const traps = [
    [1, p], [1, p % 10], [1, Math.floor(p / 10)],              // «число = картинка» і цифри добутку
    [q.a, q.b + 1], [q.a, q.b - 1], [q.a + 1, q.b], [q.a - 1, q.b], // сусіди в таблиці
    [1, q.a + 1], [1, q.a - 1], [1, q.b + 1], [1, q.b - 1],     // сусідні числа
  ];
  const extra = [];
  const add = ([r, c]) => {
    if (r < 0 || c < 0 || r > 9 || c > 9) return;
    const pid = pictureId(r, c);
    if (used.has(pid)) return;
    used.add(pid);
    extra.push({ r, c, pid });
  };
  shuffle(traps, rng).forEach(add);
  for (let guard = 0; extra.length + need.length < size && guard < 300; guard++) {
    add([1 + Math.floor(rng() * 9), 1 + Math.floor(rng() * 9)]);
  }
  const bank = [...need, ...extra.slice(0, size - need.length)];
  return shuffle(bank, rng).map((piece, i) => ({ ...piece, id: i }));
}

// ---------- Початкові рівні «Вгадай цифру» і «Вгадай число» ----------

/** 10 завдань: картинка цифри 0–9 (сонечко, маяк, дракончик, …) → натиснути цифру. */
export function digitQuestions() {
  return Array.from({ length: 10 }, (_, d) => ({ a: d, b: 1, answer: d, key: `d${d}`, pic: [d, 1] }));
}

/** Усі двоцифрові добутки таблиці з картинкою (10, 12, 14, … 81) — 27 завдань. */
export function numberQuestions() {
  const seen = new Map();
  for (let r = 2; r <= 9; r++) for (let c = r; c <= 9; c++) {
    const v = r * c;
    if (v >= 10 && !seen.has(v)) seen.set(v, { a: r, b: c, answer: v, key: `p${v}`, pic: [r, c] });
  }
  return [...seen.values()].sort((x, y) => x.answer - y.answer);
}

/** 4 варіанти для «Вгадай число»: правильний + 3 найближчі двоцифрові добутки. */
export function makeNumberChoices(q, rng = Math.random) {
  const pool = numberQuestions().map(x => x.answer);
  const i = pool.indexOf(q.answer);
  const near = [i - 1, i + 1, i - 2, i + 2, i - 3, i + 3].filter(j => j >= 0 && j < pool.length).map(j => pool[j]);
  const wrong = shuffle(near.slice(0, 5), rng).slice(0, 3);
  return shuffle([q.answer, ...wrong], rng).map(value => ({ value }));
}

// ---------- «Історії»: знайомство з історією кожного прикладу уроку ----------

/** Приклади уроку з різними історіями: a — множник уроку, b — 2…9 (3×4 і 4×3 — одна історія).
 *  В уроці 1 ще по одному прикладу на 0 і 1 (історія «маяк і сонечко»). */
export function storyQuestions(factors, rng = Math.random) {
  const out = [], seen = new Set();
  for (const a of factors) {
    if (a <= 1) {
      const b = 2 + Math.floor(rng() * 8);
      out.push({ a, b, answer: a * b, key: `${a}x${b}` });
      continue;
    }
    for (let b = 2; b <= 9; b++) {
      const k = `${Math.min(a, b)}x${Math.max(a, b)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ a, b, answer: a * b, key: `${a}x${b}` });
    }
  }
  return out;
}

// ---------- Екзамен ----------

/** Уся таблиця множення 1×1 … 9×9 — 81 приклад. */
export function examQuestions() {
  const out = [];
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) out.push({ a, b, answer: a * b, key: `${a}x${b}` });
  return out;
}

// ---------- «Вгадай число»: нові картинки уроку ----------

/**
 * Картинки, які дитина вперше зустрічає в уроці: урок 1 — усі герої-цифри (0–9) і добутки ×2,
 * далі — лише нові добутки (картинка, що вже була в попередньому уроці, не повторюється).
 * Урок 1: 18 картинок, урок 2: 9, урок 3: 8, урок 4: 6.
 */
export function guessQuestions(lessons, lessonId) {
  const seen = new Set();
  for (const l of lessons) {
    if (l.exam) continue;
    const out = [];
    const add = (key, a, b, answer) => { if (!seen.has(key)) { seen.add(key); out.push({ a, b, answer, key, pic: [a, b] }); } };
    if (l.id === lessons[0].id) for (let d = 0; d <= 9; d++) add(d === 0 ? 'zero' : `n${d}`, d, 1, d);
    for (const a of l.factors) for (let b = 2; b <= 9; b++) {
      if (a < 2) continue;
      const [r, c] = a <= b ? [a, b] : [b, a];
      add(`p${a * b}`, r, c, a * b);
    }
    if (l.id === Number(lessonId)) return out;
  }
  return [];
}

/** 4 варіанти для «Вгадай число»: правильний + 3 близькі числа з таблиці (цифри 0–9 і добутки). */
const ALL_VALUES = [...new Set([...Array(10).keys(), ...numberQuestions().map(x => x.answer), 4, 6, 8, 9])].sort((x, y) => x - y);
export function makeGuessChoices(q, rng = Math.random) {
  const i = ALL_VALUES.indexOf(q.answer);
  const near = [i - 1, i + 1, i - 2, i + 2, i - 3, i + 3].filter(j => j >= 0 && j < ALL_VALUES.length).map(j => ALL_VALUES[j]);
  const wrong = shuffle(near.slice(0, 5), rng).slice(0, 3);
  return shuffle([q.answer, ...wrong], rng).map(value => ({ value }));
}

// ---------- «Знайди картинку»: відповідь на питання історії — картинка добутку ----------

/**
 * 3 картинки-варіанти: правильна (картинка добутку a×b) + 2 картинки ІНШИХ добутків.
 * Пастки — сусідні добутки в таблиці (a×(b±1), (a±1)×b); для ×0 і ×1 — картинка добутку з тим самим
 * числом (1×6 — равлик, а пастка 2×3 — свисток), далі випадкові добутки.
 */
export function picChoices(q, n = 3, rng = Math.random) {
  const right = { r: q.a, c: q.b, pid: pictureId(q.a, q.b), ok: true };
  const used = new Set([right.pid]);
  const p = q.a * q.b, out = [right];
  const add = ([r, c]) => {
    if (out.length >= n || r < 2 || c < 2 || r > 9 || c > 9) return;   // лише картинки добутків
    const pid = pictureId(r, c);
    if (used.has(pid)) return;
    used.add(pid);
    out.push({ r, c, pid, ok: false });
  };
  const same = [];
  for (let r = 2; r <= 9; r++) for (let c = r; c <= 9; c++) if (r * c === p) same.push([r, c]);
  shuffle(same, rng).forEach(add);
  shuffle([[q.a, q.b + 1], [q.a, q.b - 1], [q.a + 1, q.b], [q.a - 1, q.b], [q.b, q.a + 1], [q.b + 1, q.a]], rng).forEach(add);
  for (let guard = 0; out.length < n && guard < 300; guard++) add([2 + Math.floor(rng() * 8), 2 + Math.floor(rng() * 8)]);
  return shuffle(out, rng).map((o, i) => ({ ...o, id: i, off: false }));
}
