// Ігрова логіка без DOM: черга прикладів, перевірка відповідей, бали, життя, результат.
// Завдяки цьому її можна тестувати окремо (див. tests/engine.test.mjs).

import { SCORING } from './config.js';

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {           // Фішер–Єйтс: рівномірне перемішування
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const makeQuestion = (a, b) => ({ a, b, answer: a * b, key: `${a}x${b}` });

export function buildQueue(factors, rng = Math.random) {
  const all = [];
  for (const f of factors) for (let n = 0; n <= 9; n++) all.push(makeQuestion(f, n));
  return shuffle(all, rng);
}

/** Три правдоподібні неправильні варіанти: сусіди в таблиці множення, а не випадкове ±5. */
export function makeChoices(q, rng = Math.random) {
  const near = [
    [q.a, q.b + 1], [q.a, q.b - 1], [q.a + 1, q.b], [q.a - 1, q.b],
    [q.a, q.b + 2], [q.a, q.b - 2], [q.a + 1, q.b + 1], [q.a - 1, q.b - 1],
  ].filter(([a, b]) => a >= 0 && b >= 0 && a <= 9 && b <= 9);

  const used = new Set([q.answer]);
  const wrong = [];
  for (const [a, b] of shuffle(near, rng)) {
    if (wrong.length === 3) break;
    if (!used.has(a * b)) { used.add(a * b); wrong.push({ a, b, value: a * b }); }
  }
  // Запасний варіант для країв таблиці (0, 1, 9): добутки з того самого рядка/стовпця, напр. 0×3 → 3, 6, 9
  const backup = [];
  for (let k = 1; k <= 9; k++) backup.push([q.b, k], [k, q.a]);
  for (const [a, b] of shuffle(backup, rng)) {
    if (wrong.length === 3) break;
    if (!used.has(a * b)) { used.add(a * b); wrong.push({ a, b, value: a * b }); }
  }
  for (let k = 1; wrong.length < 3; k++) {             // 0×0: ряди з нулями — беремо 1, 2, 3…
    if (!used.has(k)) { used.add(k); wrong.push({ a: 1, b: k, value: k }); }
  }
  return shuffle([{ a: q.a, b: q.b, value: q.answer, correct: true }, ...wrong], rng);
}

/**
 * Створює одну гру (сесію).
 * @param {{lesson:{factors:number[]}, mode:object, rng?:()=>number, now?:()=>number}} opts
 */
export function createGame({ lesson, mode, rng = Math.random, now = () => Date.now() }) {
  const endless = mode.queue === 'endless';
  const queue = endless ? [] : buildQueue(lesson.factors, rng);

  const s = {
    total: queue.length,
    lives: mode.lives,
    question: null,
    attemptsOnCurrent: 0,
    hintOnCurrent: false,
    wrongOnCurrent: false,
    finished: false,
    passed: false,
    startedAt: now(),
    endedAt: null,
    stats: { score: 0, questions: 0, correct: 0, errors: 0, hints: 0 },
  };

  function randomQuestion() {
    let q;
    do {
      const f = lesson.factors[Math.floor(rng() * lesson.factors.length)];
      q = makeQuestion(f, Math.floor(rng() * 10));
    } while (s.question && q.key === s.question.key);   // без повтору підряд
    return q;
  }

  function end(passed) {
    if (s.finished) return;
    s.finished = true;
    s.passed = passed;
    s.endedAt = now();
    s.question = null;
  }

  /** Наступний приклад або null, якщо гра закінчилась. */
  function next() {
    if (s.finished) return null;
    s.attemptsOnCurrent = 0;
    s.hintOnCurrent = false;
    s.wrongOnCurrent = false;
    s.question = endless ? randomQuestion() : queue.shift() || null;
    if (!s.question) { end(mode.lives === 0 || s.lives > 0); return null; }
    s.stats.questions += 1;
    return s.question;
  }

  /** Підказку, яку дитина відкрила сама, рахуємо один раз на приклад. */
  function useHint() {
    if (!s.question || s.hintOnCurrent) return;
    s.hintOnCurrent = true;
    s.stats.hints += 1;
  }

  /**
   * Перевірка відповіді.
   * then: 'next'  — перейти до наступного прикладу
   *       'retry' — ще одна спроба цього ж прикладу (показати підказку)
   *       'end'   — гра закінчилась
   * reveal: true — показати правильну відповідь
   */
  function answer(value) {
    const q = s.question;
    if (!q || s.finished) return null;
    s.attemptsOnCurrent += 1;

    if (value === q.answer) {
      s.stats.correct += 1;
      if (!s.hintOnCurrent && !s.wrongOnCurrent) s.stats.score += SCORING.clean;
      return { right: true, reveal: false, then: 'next', correctAnswer: q.answer };
    }

    s.stats.errors += 1;
    if (!s.wrongOnCurrent) {
      s.wrongOnCurrent = true;
      s.stats.score = Math.max(0, s.stats.score - SCORING.penalty);
      if (mode.requeue) {                               // повернеться через кілька прикладів
        const at = Math.min(queue.length, 3 + Math.floor(rng() * 3));
        queue.splice(at, 0, makeQuestion(q.a, q.b));
        s.total += 1;
      }
    }

    if (mode.lives > 0) {
      s.lives -= 1;
      if (s.lives <= 0) { end(endless && s.stats.score > 0); /* марафон зараховано, якщо є хоч 1 бал */ return { right: false, reveal: true, then: 'end', correctAnswer: q.answer }; }
    }

    const canRetry = mode.retry && s.attemptsOnCurrent < 2;
    return { right: false, reveal: !canRetry, then: canRetry ? 'retry' : 'next', correctAnswer: q.answer };
  }

  /** Достроково завершити (кнопка «Фініш» у марафоні). */
  function finish() { end(endless && s.stats.score > 0); }

  const elapsedMs = () => (s.endedAt ?? now()) - s.startedAt;

  function progress() {
    const remaining = queue.length + (s.question ? 1 : 0);
    return { total: s.total, remaining, done: s.total - remaining };
  }

  function result() {
    const secs = Math.max(1, Math.round(elapsedMs() / 1000));
    return {
      ...s.stats,
      passed: s.passed,
      time: Math.round(elapsedMs() / 1000),
      perMinute: Math.round((s.stats.correct / secs) * 60 * 10) / 10,
      speed: Math.round((s.stats.correct / secs) * 100) / 100, // прикладів/с — як у старій таблиці
    };
  }

  return {
    mode, lesson, next, answer, useHint, finish, progress, result, elapsedMs,
    get question() { return s.question; },
    get lives() { return s.lives; },
    get finished() { return s.finished; },
    get stats() { return { ...s.stats }; },
    get hintOnCurrent() { return s.hintOnCurrent; },
  };
}

/** Чи кращий новий результат за збережений рекорд: більше балів, а при рівних — швидше. */
export function isBetter(rec, old) {
  if (!old) return true;
  if (rec.score !== old.score) return rec.score > (old.score ?? 0);
  return rec.time < (old.time ?? Infinity);
}
