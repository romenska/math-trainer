// Арифметичні дії курсу: множення, додавання, віднімання, ділення.
// Курс вибирає дію в course.json → "operation": "mul" | "add" | "sub" | "div".
// Урок задає числа уроку (factors), а дія — які приклади з них виходять:
//   mul  ×3: 3×0 … 3×9            add  +3: 3+0 … 3+9
//   sub  −3: 3−3 … 12−3 (відповідь 0…9)   div  ÷3: 3÷3 … 27÷3 (відповідь 1…9)

const q = (a, b, answer, sym) => ({ a, b, answer, key: `${a}${sym}${b}` });

export const OPERATIONS = {
  mul: {
    sign: '×', name: 'Множення',
    // з нулем лишаємо тільки 0×0, 0×1 і 1×0 — інші «×0» не пропонуємо
    pairs: f => Array.from({ length: 10 }, (_, n) => n).filter(n => f * n !== 0 || (f <= 1 && n <= 1)).map(n => q(f, n, f * n, 'x')),
    random: (f, n) => q(f, n, f * n, 'x'),
    allowed: (a, b) => a * b !== 0 || (a <= 1 && b <= 1),
    // екзамен — уся таблиця 1×1 … 9×9
    exam: () => { const out = []; for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) out.push(q(a, b, a * b, 'x')); return out; },
  },
  add: {
    sign: '+', name: 'Додавання',
    pairs: f => Array.from({ length: 10 }, (_, n) => q(f, n, f + n, 'p')),
    random: (f, n) => q(f, n, f + n, 'p'),
    allowed: () => true,
    hint: (a, b) => `Від ${a} порахуй ще ${b} ${b === 1 ? 'крок' : b >= 2 && b <= 4 ? 'кроки' : 'кроків'} уперед`,
  },
  sub: {
    sign: '−', name: 'Віднімання',
    pairs: f => Array.from({ length: 10 }, (_, n) => q(f + n, f, n, 'm')),
    random: (f, n) => q(f + n, f, n, 'm'),
    allowed: () => true,
    hint: (a, b) => `Яке число разом з ${b} дає ${a}?`,
  },
  div: {
    sign: '÷', name: 'Ділення',
    pairs: f => (f > 0 ? Array.from({ length: 9 }, (_, i) => q(f * (i + 1), f, i + 1, 'd')) : []),
    random: (f, n) => q(f * (n || 1), f || 1, n || 1, 'd'),
    allowed: () => true,
    hint: (a, b) => `На скільки треба помножити ${b}, щоб вийшло ${a}?`,
  },
};

/** Варіанти відповіді для будь-якої дії, крім множення: сусідні числа (±1, ±2, ±3), не менше 0. */
export function nearChoices(q, rng = Math.random) {
  const used = new Set([q.answer]);
  const pool = [1, -1, 2, -2, 3, -3, 4, 5].map(d => q.answer + d).filter(v => v >= 0);
  const wrong = [];
  for (const v of pool.sort(() => rng() - 0.5)) {
    if (wrong.length === 3) break;
    if (!used.has(v)) { used.add(v); wrong.push({ a: q.a, b: q.b, value: v }); }
  }
  return [{ a: q.a, b: q.b, value: q.answer, correct: true }, ...wrong];
}
