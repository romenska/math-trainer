// Запуск: node tests/engine.test.mjs  (потрібен Node 18+)
import assert from 'node:assert/strict';
import { createGame, makeChoices, buildQueue, isBetter } from '../js/engine.js?v=3.82';
import { getLesson, getMode, SEQUENCE, LESSONS } from '../js/config.js?v=3.82';
import { textHint, storyImage, storyVideo } from '../js/hints.js?v=3.82';
import { pictureId, neededPieces, recallBank, digitQuestions, numberQuestions, makeNumberChoices, storyQuestions, examQuestions, guessQuestions, makeGuessChoices } from '../js/pictures.js?v=3.82';

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

test('марафон: без повторів підряд, фініш з балами = пройдено', () => {
  const g = createGame({ lesson: L4, mode: getMode('records'), rng });
  let prev = null;
  for (let i = 0; i < 200; i++) { const q = g.next(); assert.notEqual(q.key, prev); prev = q.key; g.answer(q.answer); }
  g.finish(); assert.ok(g.result().passed); assert.equal(g.result().score, 200);
});

test('марафон: закінчується одразу після першої помилки', () => {
  const g = createGame({ lesson: L1, mode: getMode('records'), rng });
  for (let i = 0; i < 5; i++) { g.next(); g.answer(g.question.answer); }
  g.next(); assert.equal(g.answer(-1).then, 'end');
  assert.ok(g.finished); assert.equal(g.result().score, 5, 'бали не знімаються'); assert.ok(g.result().passed);
  const g0 = createGame({ lesson: L1, mode: getMode('records'), rng });
  g0.next(); g0.answer(-1);
  assert.ok(g0.finished); assert.equal(g0.result().passed, false, '0 балів — не зараховано');
});

test('текстова підказка: лише навідне питання з дужок', () => {
  assert.equal(textHint(2, 2), 'в яку гру грали два дракончики?');
  assert.ok(!textHint(2, 2).includes('доміно'));
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

test('послідовність етапів: без дублів', () => {
  assert.equal(new Set(SEQUENCE).size, SEQUENCE.length);
});

test('підказки: є для всіх прикладів 2–9, симетрія, історії для ×2/×3/×4', () => {
  for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) assert.ok(textHint(a, b), `${a}x${b}`);
  assert.equal(textHint(3, 7), textHint(7, 3));
  assert.equal(storyImage(5, 2), 'assets/story/2x5.webp');
  assert.equal(storyImage(8, 7), 'assets/story/7x8.webp');
  assert.equal(storyImage(9, 9), 'assets/story/9x9.webp');
});

test('послідовність: кожен урок починається з «Вгадай число», екзамен — останній', () => {
  assert.equal(SEQUENCE.length, 4 * 8 + 1);
  assert.deepEqual(SEQUENCE.slice(0, 8), ['1_guess', '1_stories', '1_associations', '1_remember', '1_recall', '1_training', '1_speed', '1_records']);
  assert.equal(SEQUENCE[8], '2_guess');
  assert.equal(SEQUENCE.at(-1), '5_exam');
});

test('«Вгадай число»: картинки поділено на 4 уроки без повторів, разом — усі 10 героїв і всі добутки', () => {
  const per = [1, 2, 3, 4].map(id => guessQuestions(LESSONS, id));
  assert.deepEqual(per.map(q => q.length), [18, 9, 8, 6]);
  const keys = per.flat().map(q => q.key);
  assert.equal(new Set(keys).size, keys.length, 'картинка не повторюється в наступних уроках');
  assert.ok(['zero', 'n1', 'n9', 'p4', 'p18'].every(k => per[0].some(q => q.key === k)));
  assert.ok(per[3].every(q => q.a >= 7 || q.b >= 7));
  for (const q of per.flat()) {
    assert.equal(q.answer, q.pic[0] * q.pic[1]);
    const c = makeGuessChoices(q, rng).map(x => x.value);
    assert.equal(c.length, 4); assert.equal(new Set(c).size, 4); assert.ok(c.includes(q.answer));
  }
});

test('«Вгадай цифру»: 10 картинок 0–9; «Вгадай число»: 27 двоцифрових добутків', () => {
  const d = digitQuestions();
  assert.deepEqual(d.map(q => q.answer), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const n = numberQuestions();
  assert.equal(n.length, 27);
  assert.ok(n.every(q => q.answer >= 10 && q.a * q.b === q.answer && q.a >= 2));
  assert.equal(new Set(n.map(q => q.answer)).size, 27);
  for (const q of n) {
    const c = makeNumberChoices(q, rng).map(x => x.value);
    assert.equal(c.length, 4); assert.equal(new Set(c).size, 4); assert.ok(c.includes(q.answer));
  }
});

test('«Вгадай число»: помилка → ще спроба, приклад повертається, рівень до кінця', () => {
  const g = createGame({ lesson: L1, mode: getMode('numbers'), questions: numberQuestions(), rng });
  const q = g.next();
  assert.equal(g.answer(-1).then, 'retry');
  assert.equal(g.answer(q.answer).then, 'next');
  assert.equal(g.progress().total, 28);
  let again = 0;
  while (g.next()) { if (g.question.key === q.key) again++; g.answer(g.question.answer); }
  assert.equal(again, 1); assert.ok(g.result().passed);
});

test('«Запам’ятай»/«Пригадай»: помилки не закінчують приклад, доки не буде правильно', () => {
  const g = createGame({ lesson: L1, mode: getMode('recall'), rng });
  g.next();
  for (let i = 0; i < 5; i++) assert.equal(g.judge(false).then, 'retry');
  assert.equal(g.judge(true).then, 'next');
  assert.equal(g.stats.errors, 5); assert.equal(g.stats.score, 0);
  while (g.next()) g.judge(true);
  assert.equal(g.result().questions, 30); assert.ok(g.result().passed);
});

test('картинки: число 6 ≠ добуток 2×3, а 2×6 = 3×4', () => {
  assert.notEqual(pictureId(1, 6), pictureId(2, 3));
  assert.equal(pictureId(2, 6), pictureId(3, 4));
  assert.equal(pictureId(3, 2), pictureId(2, 3));
  assert.equal(pictureId(0, 7), 'zero');
});

test('«Пригадай»: 8 картинок, усі 3 потрібні є, зайві не збігаються з потрібними', () => {
  for (const f of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) for (let n = 0; n <= 9; n++) {
    const q = { a: f, b: n, answer: f * n };
    const bank = recallBank(q, 8, rng);
    const need = neededPieces(q).map(p => p.pid);
    assert.equal(bank.length, 8, `${f}x${n}`);
    const left = bank.map(p => p.pid);
    for (const pid of need) { const i = left.indexOf(pid); assert.ok(i >= 0, `${f}x${n} нема ${pid}`); left.splice(i, 1); }
    assert.ok(left.every(pid => !need.includes(pid)), `${f}x${n}: зайва = потрібна`);
    assert.equal(new Set(left).size, left.length);
  }
  // пастка «число = картинка»: для 2×3 серед зайвих є картинка числа 6
  assert.ok(recallBank({ a: 2, b: 3, answer: 6 }, 8, rng).some(p => p.pid === 'n6'));
});

test('«Історії»: кожна історія уроку один раз, у кожної є картинка або текст', () => {
  const l1 = storyQuestions([0, 1, 2], rng), l2 = storyQuestions([3, 4], rng), l4 = storyQuestions([7, 8, 9], rng);
  assert.equal(l1.length, 2 + 8);                   // 0×?, 1×?, 2×2…2×9
  assert.equal(l2.length, 8 + 7);                   // 3×2…3×9, 4×2,4×4…4×9
  assert.equal(l4.length, 8 + 7 + 6);
  for (const q of [...l1, ...l2, ...l4]) assert.ok(storyImage(q.a, q.b) || textHint(q.a, q.b), q.key);
  const keys = l4.map(q => `${Math.min(q.a, q.b)}x${Math.max(q.a, q.b)}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('відео-історії: є для 2×… і 3×…, симетрія', () => {
  assert.equal(storyVideo(2, 3), 'assets/story/2x3.mp4');
  assert.equal(storyVideo(9, 3), 'assets/story/3x9.mp4');
  assert.equal(storyVideo(4, 3), 'assets/story/4x3.mp4', '4×3 має власне відео');
  assert.equal(storyVideo(9, 4), 'assets/story/4x9.mp4');
  assert.equal(storyVideo(7, 8), null);
});

test('екзамен: 81 приклад 1×1…9×9, без повторів; помилка не дає ще спробу і не знімає бали', () => {
  const q = examQuestions();
  assert.equal(q.length, 81); assert.equal(new Set(q.map(x => x.key)).size, 81);
  const g = createGame({ lesson: getLesson(5), mode: getMode('exam'), questions: q, rng });
  g.next(); g.answer(g.question.answer);
  g.next(); const r = g.answer(-1);
  assert.equal(r.then, 'next'); assert.equal(g.stats.score, 1);
  while (g.next()) g.answer(g.question.answer);
  assert.equal(g.result().questions, 81); assert.equal(g.result().correct, 80); assert.ok(g.result().passed);
});

await (async () => {
  const { shareCode } = await import('../js/cloud.js?v=3.82');
  const c = await shareCode('dev_k3j9x2mq81');
  assert.match(c, /^[0-9a-f]{16}$/); assert.equal(c, await shareCode('dev_k3j9x2mq81'));
  assert.notEqual(c, await shareCode('dev_k3j9x2mq82'));
  passed++; console.log('✓ код перегляду: 16 hex, стабільний, різний для різних паролів', c);
})();

console.log(`\n${passed} тестів пройдено`);
