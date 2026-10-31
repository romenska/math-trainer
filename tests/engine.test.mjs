// Запуск: node tests/engine.test.mjs  (потрібен Node 18+)
import assert from 'node:assert/strict';
import { createGame, makeChoices, buildQueue, isBetter } from '../js/engine.js';
import { getLesson, getMode, SEQUENCE } from '../js/config.js';
import { textHint, storyImage } from '../js/hints.js';

let seed = 42;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const L1 = getLesson(1), L4 = getLesson(4);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };

test('черга: кожен приклад уроку рівно один раз', () => {
  const q = buildQueue(L1.factors, rng);
  assert.equal(q.length, 30);
  assert.equal(new Set(q.map(x => x.key)).size, 30);
});

test('варіанти: 4 різні, рівно один правильний, без від’ємних', () => {
  for (const f of [0, 1, 2, 5, 9]) for (let n = 0; n <= 9; n++) {
    const q = { a: f, b: n, answer: f * n };
    const c = makeChoices(q, rng);
    assert.equal(c.length, 4);
    assert.equal(new Set(c.map(x => x.value)).size, 4);
    assert.equal(c.filter(x => x.value === q.answer).length, 1);
    assert.ok(c.every(x => x.value >= 0 && x.a * x.b === x.value));
  }
});

test('тренування без помилок: 30 балів, пройдено', () => {
  const g = createGame({ lesson: L1, mode: getMode('training'), rng });
  while (g.next()) assert.equal(g.answer(g.question.answer).then, 'next');
  const r = g.result();
  assert.equal(r.score, 30); assert.equal(r.questions, 30); assert.equal(r.errors, 0); assert.ok(r.passed);
});

test('тренування: помилка → ще спроба → приклад повертається в чергу', () => {
  const g = createGame({ lesson: L1, mode: getMode('training'), rng });
  const q = g.next();
  const r1 = g.answer(q.answer + 1);
  assert.equal(r1.then, 'retry'); assert.equal(r1.reveal, false);
  assert.equal(g.answer(q.answer).then, 'next');
  assert.equal(g.stats.score, 0);
  assert.equal(g.progress().total, 31);
  let seen = 0;
  while (g.next()) { if (g.question.key === q.key) seen++; g.answer(g.question.answer); }
  assert.equal(seen, 1, 'приклад з помилкою з’являється ще раз');
});

test('друга помилка поспіль → показати відповідь і йти далі, штраф лише один раз', () => {
  const g = createGame({ lesson: L1, mode: getMode('training'), rng });
  g.next(); g.answer(g.question.answer);
  const before = g.stats.score;
  assert.equal(before, 1);
  const q2 = g.next();
  g.answer(q2.answer + 1);
  const r = g.answer(q2.answer + 2);
  assert.equal(r.then, 'next'); assert.equal(r.reveal, true);
  assert.equal(g.stats.score, Math.max(0, before - 1));
  assert.equal(g.stats.errors, 2);
});

test('підказка рахується один раз і забирає бал за приклад', () => {
  const g = createGame({ lesson: L1, mode: getMode('training'), rng });
  g.next(); g.useHint(); g.useHint();
  g.answer(g.question.answer);
  assert.equal(g.stats.hints, 1); assert.equal(g.stats.score, 0);
});

test('перевірка: 3 помилки → кінець, не пройдено', () => {
  const g = createGame({ lesson: L1, mode: getMode('speed'), rng });
  g.next(); assert.equal(g.answer(-1).then, 'next');
  g.next(); assert.equal(g.answer(-1).then, 'next');
  g.next(); assert.equal(g.answer(-1).then, 'end');
  assert.ok(g.finished); assert.equal(g.result().passed, false); assert.equal(g.next(), null);
});

test('перевірка: 2 помилки з 30 → пройдено', () => {
  const g = createGame({ lesson: L1, mode: getMode('speed'), rng });
  let i = 0;
  while (g.next()) g.answer(i++ < 2 ? -1 : g.question.answer);
  assert.equal(g.result().passed, true); assert.equal(g.result().questions, 30);
});

test('марафон: без повторів підряд, фініш = пройдено, 3 помилки = кінець', () => {
  const g = createGame({ lesson: L4, mode: getMode('records'), rng });
  let prev = null;
  for (let i = 0; i < 200; i++) { const q = g.next(); assert.notEqual(q.key, prev); prev = q.key; g.answer(q.answer); }
  g.finish(); assert.ok(g.result().passed); assert.equal(g.result().score, 200);
  const g2 = createGame({ lesson: L4, mode: getMode('records'), rng });
  for (let i = 0; i < 3; i++) { g2.next(); g2.answer(-1); }
  assert.ok(g2.finished); assert.equal(g2.result().passed, false, '0 балів — марафон не зараховано');
});

test('марафон: 1-ша і 2-га помилки не завершують гру', () => {
  const g = createGame({ lesson: L1, mode: getMode('records'), rng });
  for (let i = 0; i < 5; i++) { g.next(); g.answer(g.question.answer); }
  g.next(); assert.equal(g.answer(-1).then, 'next');
  g.next(); assert.equal(g.answer(-1).then, 'next');
  assert.ok(!g.finished); assert.equal(g.lives, 1);
  g.next(); assert.equal(g.answer(-1).then, 'end'); assert.ok(g.result().passed);
});

test('відповідь після кінця гри ігнорується', () => {
  const g = createGame({ lesson: L1, mode: getMode('speed'), rng });
  for (let i = 0; i < 3; i++) { g.next(); g.answer(-1); }
  assert.equal(g.answer(0), null);
});

test('рекорд: більше балів, при рівних — швидше', () => {
  assert.ok(isBetter({ score: 5, time: 60 }, undefined));
  assert.ok(isBetter({ score: 6, time: 99 }, { score: 5, time: 10 }));
  assert.ok(isBetter({ score: 5, time: 40 }, { score: 5, time: 60 }));
  assert.ok(!isBetter({ score: 5, time: 60 }, { score: 5, time: 60 }));
});

test('послідовність етапів: 16 штук, без дублів', () => {
  assert.equal(SEQUENCE.length, 16); assert.equal(new Set(SEQUENCE).size, 16);
});

test('підказки: є для всіх прикладів 2–9, симетрія, історії для ×2/×3/×4', () => {
  for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) assert.ok(textHint(a, b), `${a}x${b}`);
  assert.equal(textHint(3, 7), textHint(7, 3));
  assert.equal(storyImage(5, 2), 'assets/story/2x5.webp');
  assert.equal(storyImage(7, 8), null);
});

console.log(`\n${passed} тестів пройдено`);
