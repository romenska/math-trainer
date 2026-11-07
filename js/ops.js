// Арифметичні дії курсу: множення і ділення.
// Курс вибирає дію в course.json → "operation": "mul" | "div".
// Урок задає числа уроку (factors), а дія — які приклади з них виходять:
//   mul  ×3: 3×0 … 3×9            div  ÷3: 3÷3 … 27÷3 (відповідь 1…9)

const q = (a, b, answer, sym) => ({ a, b, answer, key: `${a}${sym}${b}` });
/** Ділення на f з відповіддю n: (f·n) ÷ f = n; m = [n, f] — пара множення для картинок та історій. */
const dq = (f, n) => ({ ...q(f * n, f, n, 'd'), m: [n, f] });
/** Пара множення для картинок, історій і підказок: у множенні — [a, b], у діленні — [відповідь, дільник]. */
export const mulPair = x => x.m || [x.a, x.b];

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
  div: {
    // a ÷ b = відповідь; m — та сама пара в множенні (відповідь × b = a): за нею картинки, історії й підказки
    sign: '÷', name: 'Ділення',
    pairs: f => (f > 0 ? Array.from({ length: 9 }, (_, i) => dq(f, i + 1)) : []),
    random: (f, n) => dq(f || 1, n || 1),
    allowed: () => true,
    fromMul: q => (q.a > 0 ? dq(q.a, q.b) : dq(q.b || 1, 0)),   // дільник — число уроку
    exam: () => { const out = []; for (let x = 1; x <= 9; x++) for (let y = 1; y <= 9; y++) out.push(dq(y, x)); return out; },
  },
};

/** Варіанти відповіді для ділення: сусідні числа (±1, ±2, ±3), не менше 0; картинка варіанта — картинка числа. */
export function nearChoices(q, rng = Math.random) {
  const used = new Set([q.answer]);
  const pool = [1, -1, 2, -2, 3, -3, 4, 5].map(d => q.answer + d).filter(v => v >= 0 && v <= 9);
  const wrong = [];
  for (const v of pool.sort(() => rng() - 0.5)) {
    if (wrong.length === 3) break;
    if (!used.has(v)) { used.add(v); wrong.push({ a: v, b: 1, value: v }); }
  }
  return [{ a: q.answer, b: 1, value: q.answer, correct: true }, ...wrong];
}
