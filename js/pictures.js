// Картинки таблиці множення: що на якій клітинці і як збирати завдання з картинок.
//
// Спрайт — таблиця 9×9: перший рядок/стовпчик — картинки ЧИСЕЛ (1 — маяк, 2 — дракон, …, 9 — глобус),
// клітинка на перетині (r, c) — картинка-асоціація ДОБУТКУ. Нуль — сонечко.
// Таблиця симетрична, і добутки з множниками ≥ 2 мають спільну картинку (2×6 і 3×4 — крокодил з вудкою).
// А от «число 6» (1×6, равлик) і «добуток 2×3» (свисток) — різні картинки. Тому порівнюємо не числа, а картинки.

import { shuffle } from './engine.js?v=2.3';

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
