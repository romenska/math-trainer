// Контролер: стан застосунку, екрани, обробка подій.

import { LESSONS, MODES, SEQUENCE, FEEDBACK_MS, getLesson, getMode } from './config.js';
import { createGame, makeChoices, isBetter } from './engine.js';
import { storage } from './storage.js';
import { loadProfile, mergeRecords, pushResult, newDeviceId, looksLikeId } from './cloud.js';
import { textHint, storyImage } from './hints.js';
import { confetti } from './confetti.js';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

const MODE_ICONS = { associations: '🧩', training: '🏋️', speed: '✅', records: '🏃' };
const MODE_RULES = {
  associations: 'Над числами — картинки-асоціації, відповідь теж обираємо картинкою. Помилка? З’явиться підказка і ще одна спроба, а приклад повернеться трохи згодом.',
  training: 'Тільки числа. Якщо важко — відкрий підказку: текст, історію або картинки (за такий приклад бал не нараховується).',
  speed: 'Без підказок, 3 життя. Перевірку пройдено, якщо розв’язати всі приклади уроку, не втративши всі життя.',
  records: 'Приклади без кінця, 3 життя. Б’ємо власний рекорд! Натисни «Фініш», щоб зупинитися.',
};

const app = {
  profile: storage.load(),
  sel: { lesson: 1, mode: 'associations' },
  game: null,
  locked: false,
  typed: '',
  tilesOn: false,
  disabledValues: new Set(),
  choices: [],
  timerId: null,
};

const stageKey = (lesson, mode) => `${lesson}_${mode}`;
const recordKey = (lesson, mode) => `L${lesson}_${mode}`;
const parseStage = s => {
  const [l, m] = String(s || '').split('_');
  return { lesson: getLesson(l).id, mode: getMode(m).id };
};
const fmtTime = secs => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
const isPassed = (lesson, mode) => {
  const r = app.profile.records[recordKey(lesson, mode)];
  return Boolean(r && r.passed !== false); // старі записи без поля passed вважаємо пройденими
};

/** Рекомендований етап: збережений прогрес, але не раніше за останній пройдений + 1. */
function normalizeProgress() {
  let idx = Math.max(0, SEQUENCE.indexOf(app.profile.progress));
  SEQUENCE.forEach((s, i) => {
    const { lesson, mode } = parseStage(s);
    if (isPassed(lesson, mode)) idx = Math.max(idx, Math.min(i + 1, SEQUENCE.length - 1));
  });
  app.profile.progress = SEQUENCE[idx];
  storage.saveProgress(app.profile.progress);
}

// ---------- Екрани ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  if (id !== 'screen-game') stopTimer();
}

function toast(text, ms = 2200) {
  const t = $('#toast');
  (document.querySelector('dialog[open]') || document.body).appendChild(t); // поверх відкритого вікна
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Вхід / вихід ----------
$('#login-form').addEventListener('submit', e => {
  e.preventDefault();
  const value = $('#login-input').value.trim();
  if (!value) return;
  if (looksLikeId(value)) {
    app.profile = { ...storage.load(), deviceId: value, nickname: '', records: {}, progress: SEQUENCE[0] };
    storage.saveProfile(app.profile);
    openMenu(true);
    sync({ fromLogin: true });
  } else {
    app.profile = { ...app.profile, deviceId: newDeviceId(), nickname: value, records: {}, progress: SEQUENCE[0] };
    storage.saveProfile(app.profile);
    pushResult({ action: 'register', deviceId: app.profile.deviceId, nickname: value,  // новий рядок у листі «Учні»
      inputMode: app.profile.inputMode === 'novice' ? 'Новачок' : 'Експерт', currentCombinedLevel: SEQUENCE[0] });
    storage.saveRecords({});
    storage.saveProgress(SEQUENCE[0]);
    openMenu(true);
  }
});

$('#btn-logout').addEventListener('click', () => {
  $('#logout-id').textContent = app.profile.deviceId;
  $('#dlg-logout').showModal();
});
$('#logout-confirm').addEventListener('click', () => {
  storage.clear();
  app.profile = storage.load();
  $('#dlg-logout').close();
  $('#login-input').value = '';
  show('screen-login');
});

document.querySelectorAll('[data-copy-id]').forEach(btn => btn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(app.profile.deviceId); toast('ID скопійовано'); }
  catch { toast('Не вдалося скопіювати — виділи ID вручну'); }
}));
document.querySelectorAll('dialog [data-close]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
  if (e.target === d && d.id !== 'dlg-result') d.close(); // клік по фону закриває (крім результату)
}));

// ---------- Хмара ----------
async function sync({ fromLogin = false } = {}) {
  if (!app.profile.deviceId) return;
  const status = $('#sync-status');
  status.textContent = '☁️ Синхронізація…';
  const remote = await loadProfile(app.profile.deviceId);
  if (!remote) {
    status.textContent = fromLogin ? '⚠️ Хмара не відповіла' : '💾 Збережено на пристрої';
    if (fromLogin) toast('Не вдалося завантажити дані для цього ID. Перевір ID або інтернет.');
    return;
  }
  const p = app.profile;
  p.records = mergeRecords(p.records, remote.records);
  if (remote.nickname && (fromLogin || !p.nickname)) p.nickname = remote.nickname;
  if (fromLogin && remote.inputMode) p.inputMode = remote.inputMode;
  if (remote.progress && SEQUENCE.indexOf(remote.progress) > SEQUENCE.indexOf(p.progress)) p.progress = remote.progress;
  storage.saveProfile(p);
  storage.saveRecords(p.records);
  storage.saveInputMode(p.inputMode);
  normalizeProgress();
  status.textContent = '☁️ Синхронізовано';
  if (!$('#screen-menu').hidden) openMenu(fromLogin);
}

// ---------- Меню ----------
function openMenu(resetSelection = true) {
  normalizeProgress();
  if (!$('#sync-status').textContent) $('#sync-status').textContent = '💾 Збережено на пристрої';
  if (resetSelection) app.sel = parseStage(app.profile.progress);
  renderMenu();
  show('screen-menu');
}

function renderMenu() {
  const { profile, sel } = app;
  const name = profile.nickname || 'Учень';
  $('#user-name').textContent = name;
  $('#user-avatar').textContent = name.trim()[0]?.toUpperCase() || '?';
  const rec = parseStage(profile.progress);

  const lessons = $('#lesson-list');
  lessons.replaceChildren(...LESSONS.map(l => {
    const b = el('button', { type: 'button', className: 'lesson' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l.id === sel.lesson));
    b.dataset.lesson = l.id;
    b.innerHTML = `<div class="lesson__top"><span class="lesson__num">Урок ${l.id}</span></div>
      <div class="lesson__factors">× ${l.factors.join(', ')}</div>
      <div class="dots">${MODES.map(m => `<span class="dot${isPassed(l.id, m.id) ? ' is-done' : ''}" title="${m.name}"></span>`).join('')}</div>`;
    return b;
  }));

  const modes = $('#mode-list');
  modes.replaceChildren(...MODES.map(m => {
    const b = el('button', { type: 'button', className: 'mode' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m.id === sel.mode));
    b.dataset.mode = m.id;
    const isNext = rec.lesson === sel.lesson && rec.mode === m.id;
    b.innerHTML = `<span class="mode__icon" aria-hidden="true">${MODE_ICONS[m.id]}</span>${m.name}
      ${isPassed(sel.lesson, m.id) ? '<span class="mode__check" aria-label="пройдено">✓</span>' : ''}
      ${isNext ? '<span class="mode__next">наступний</span>' : ''}`;
    return b;
  }));

  document.querySelectorAll('#input-mode [data-input]').forEach(b =>
    b.setAttribute('aria-checked', String(b.dataset.input === profile.inputMode)));
}

$('#lesson-list').addEventListener('click', e => {
  const b = e.target.closest('[data-lesson]');
  if (!b) return;
  app.sel.lesson = Number(b.dataset.lesson);
  renderMenu();
});
$('#mode-list').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  app.sel.mode = b.dataset.mode;
  renderMenu();
  toast(MODE_RULES[app.sel.mode], 5000);
});
$('#input-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-input]');
  if (!b) return;
  app.profile.inputMode = b.dataset.input;
  storage.saveInputMode(app.profile.inputMode);
  renderMenu();
});
$('#btn-stats').addEventListener('click', openStats);
$('#btn-start').addEventListener('click', () => startGame(app.sel.lesson, app.sel.mode));

// ---------- Гра ----------
function startGame(lessonId, modeId) {
  const lesson = getLesson(lessonId), mode = getMode(modeId);
  app.sel = { lesson: lesson.id, mode: mode.id };
  app.game = createGame({ lesson, mode });
  $('#toast').hidden = true;
  app.tilesOn = mode.tilesOn;
  app.locked = false;

  $('#game-lesson').textContent = `Урок ${lesson.id} · ×${lesson.factors.join(', ')}`;
  $('#game-mode').textContent = `${MODE_ICONS[mode.id]} ${mode.name}`;
  $('#btn-exit').hidden = mode.queue === 'endless';
  $('#btn-finish').hidden = mode.queue !== 'endless';
  $('#game-hearts').hidden = mode.lives === 0;
  $('#game-progress').hidden = mode.queue === 'endless';
  $('#choices').hidden = app.profile.inputMode !== 'novice';
  $('#keypad-wrap').hidden = app.profile.inputMode !== 'expert';
  $('#hint-bar').hidden = mode.hints.length === 0;
  document.querySelectorAll('#hint-bar [data-hint]').forEach(c => { c.hidden = !mode.hints.includes(c.dataset.hint); });

  show('screen-game');
  startTimer();
  nextQuestion();
}

function nextQuestion() {
  const q = app.game.next();
  if (!q) { endGame(); return; }
  app.typed = '';
  app.disabledValues = new Set();
  app.choices = makeChoices(q);
  $('#question').classList.remove('is-right', 'is-wrong');
  hideHints();
  // Підказка «картинки» в тренуванні діє лише на один приклад
  if (app.game.mode.id === 'training') app.tilesOn = false;
  app.locked = false; // до рендеру — інакше кнопки варіантів створяться вимкненими
  renderQuestion();
  renderHud();
}

const tileHTML = (a, b) => (a * b === 0
  ? '<span class="tile tile--zero" aria-hidden="true"></span>'
  : `<span class="tile" style="--r:${a - 1};--c:${b - 1}" aria-hidden="true"></span>`);

function renderQuestion(reveal = false) {
  const q = app.game.question;
  if (!q) return;
  const picturesOnly = app.game.mode.id === 'associations'; // в асоціаціях — лише картинки, без цифр
  const num = n => (picturesOnly ? `<span class="factor factor--big">${tileHTML(n, 1)}</span>`
    : app.tilesOn ? `<span class="factor">${tileHTML(n, 1)}<span>${n}</span></span>` : `<span>${n}</span>`);
  const ans = reveal ? q.answer : (app.profile.inputMode === 'expert' && app.typed ? app.typed : '?');
  $('#expr').innerHTML = `${num(q.a)}<span class="op">×</span>${num(q.b)}<span class="op">=</span><span class="ans${reveal ? ' reveal' : ''}">${ans}</span>`;
  $('#expr').setAttribute('aria-label', `${q.a} помножити на ${q.b}`);

  // доступність підказок для цього прикладу
  const textBtn = $('#hint-bar [data-hint="text"]');
  const storyBtn = $('#hint-bar [data-hint="story"]');
  const tilesBtn = $('#hint-bar [data-hint="tiles"]');
  const hints = app.game.mode.hints;
  textBtn.hidden = !hints.includes('text') || !textHint(q.a, q.b);
  storyBtn.hidden = !hints.includes('story') || !storyImage(q.a, q.b);
  tilesBtn.setAttribute('aria-pressed', String(app.tilesOn));

  if (app.profile.inputMode === 'novice') renderChoices();
}

function renderChoices(revealValue = null, wrongValue = null) {
  const tiles = app.game.mode.tileChoices;
  $('#choices').replaceChildren(...app.choices.map((c, i) => {
    const b = el('button', { type: 'button', className: 'choice' });
    b.innerHTML = `${tiles ? tileHTML(c.a, c.b) : c.value}`;
    b.setAttribute('aria-label', String(c.value));
    b.dataset.value = c.value;
    if (app.disabledValues.has(c.value)) { b.disabled = true; b.classList.add('is-dim'); }
    if (revealValue !== null && c.value === revealValue) b.classList.add('is-right');
    if (wrongValue !== null && c.value === wrongValue) b.classList.add('is-wrong');
    if (revealValue !== null || app.locked) b.disabled = true;
    return b;
  }));
}

function renderHud() {
  const g = app.game;
  $('#game-score').textContent = g.stats.score;
  if (g.mode.lives) {
    $('#game-hearts').innerHTML = Array.from({ length: g.mode.lives }, (_, i) =>
      `<span class="${i < g.lives ? '' : 'lost'}">❤️</span>`).join('');
    $('#game-hearts').setAttribute('aria-label', `Життя: ${g.lives} з ${g.mode.lives}`);
  }
  if (g.mode.queue !== 'endless') {
    const p = g.progress();
    $('#progress-fill').style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
    $('#progress-text').textContent = `${p.done}/${p.total}`;
  }
}

function submit(value, btn = null) {
  if (app.locked || !app.game?.question) return;
  app.locked = true;
  const res = app.game.answer(value);
  const card = $('#question');
  card.classList.remove('is-right', 'is-wrong');
  void card.offsetWidth; // перезапуск анімації
  card.classList.add(res.right ? 'is-right' : 'is-wrong');
  renderHud();

  if (res.right) {
    renderQuestion(true);
    if (btn) renderChoices(value);
    setTimeout(nextQuestion, FEEDBACK_MS.right);
    return;
  }

  if (res.then === 'retry') {
    if (app.profile.inputMode === 'novice') { app.disabledValues.add(value); renderChoices(null, value); }
    setTimeout(() => {
      card.classList.remove('is-wrong');
      app.typed = '';
      showAutoHint();
      app.locked = false;
      renderQuestion();
    }, FEEDBACK_MS.wrong * 0.6);
    return;
  }

  // reveal: показати правильну відповідь, потім далі або кінець гри
  renderQuestion(true);
  if (app.profile.inputMode === 'novice') renderChoices(res.correctAnswer, value);
  setTimeout(res.then === 'end' ? endGame : nextQuestion, FEEDBACK_MS.wrong + 400);
}

$('#choices').addEventListener('click', e => {
  const b = e.target.closest('.choice');
  if (b && !b.disabled) submit(Number(b.dataset.value), b);
});

function press(key) {
  if (app.locked) return;
  if (key === 'ok') { if (app.typed) submit(Number(app.typed)); return; }
  if (key === 'back') app.typed = app.typed.slice(0, -1);
  else if (/^\d$/.test(key) && app.typed.length < 2) app.typed = app.typed === '0' ? key : app.typed + key;
  renderQuestion();
}
$('#keypad').addEventListener('click', e => {
  const b = e.target.closest('[data-key]');
  if (b) press(b.dataset.key);
});

document.addEventListener('keydown', e => {
  if ($('#screen-game').hidden || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (app.profile.inputMode === 'expert') {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
  } else if (/^[1-4]$/.test(e.key)) {
    const b = document.querySelectorAll('#choices .choice')[Number(e.key) - 1];
    if (b && !b.disabled) submit(Number(b.dataset.value), b);
  }
});

// ---------- Підказки ----------
function hideHints() {
  $('#text-hint').hidden = true;
  $('#story').hidden = true;
  $('#hint-bar [data-hint="text"]').setAttribute('aria-pressed', 'false');
  $('#hint-bar [data-hint="story"]').setAttribute('aria-pressed', 'false');
}

function showText(q) {
  const t = textHint(q.a, q.b);
  if (!t) return false;
  $('#text-hint').textContent = t;
  $('#text-hint').hidden = false;
  $('#hint-bar [data-hint="text"]').setAttribute('aria-pressed', 'true');
  return true;
}
function showStory(q) {
  const src = storyImage(q.a, q.b);
  if (!src) return false;
  const img = $('#story');
  img.onerror = () => { img.hidden = true; };
  img.src = src;
  img.hidden = false;
  $('#hint-bar [data-hint="story"]').setAttribute('aria-pressed', 'true');
  return true;
}

/** Підказка після помилки — не рахується як «взята», бал за приклад і так втрачено. */
function showAutoHint() {
  const q = app.game.question;
  hideHints();
  if (!showText(q)) showStory(q);
}

$('#hint-bar').addEventListener('click', e => {
  const b = e.target.closest('[data-hint]');
  const q = app.game?.question;
  if (!b || !q || app.locked) return;
  const kind = b.dataset.hint;
  const wasOn = b.getAttribute('aria-pressed') === 'true';

  if (kind === 'tiles') {
    app.tilesOn = !app.tilesOn;
    if (app.tilesOn) app.game.useHint();
    renderQuestion();
    return;
  }
  hideHints(); // одночасно показуємо лише одну: текст або історію
  if (wasOn) return;
  if (kind === 'text' ? showText(q) : showStory(q)) app.game.useHint();
  renderHud();
});

// ---------- Таймер ----------
function startTimer() {
  stopTimer();
  const tick = () => { $('#game-timer').textContent = fmtTime(Math.floor(app.game.elapsedMs() / 1000)); };
  tick();
  app.timerId = setInterval(tick, 500);
}
function stopTimer() { clearInterval(app.timerId); app.timerId = null; }

$('#btn-exit').addEventListener('click', () => { app.game = null; openMenu(false); });
$('#btn-finish').addEventListener('click', () => { if (!app.locked) { app.game.finish(); endGame(); } });

// ---------- Кінець гри ----------
function endGame() {
  const g = app.game;
  if (!g) return;
  stopTimer();
  const r = g.result();
  const { lesson, mode } = app.sel;
  const key = recordKey(lesson, mode);
  const old = app.profile.records[key];
  const now = new Date();
  const record = {
    score: r.score, totalQuestions: r.questions, correct: r.correct, errors: r.errors,
    hintsCount: r.hints, time: r.time, speed: r.speed, passed: r.passed,
    date: `${now.toLocaleDateString('uk-UA')} ${now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`,
  };
  const better = isBetter(record, old);
  if (better) app.profile.records[key] = { ...record, passed: r.passed || Boolean(old?.passed) };
  else if (r.passed && old) old.passed = true;
  storage.saveRecords(app.profile.records);

  const idx = SEQUENCE.indexOf(stageKey(lesson, mode));
  if (r.passed && idx >= SEQUENCE.indexOf(app.profile.progress) && idx < SEQUENCE.length - 1) {
    app.profile.progress = SEQUENCE[idx + 1];
    storage.saveProgress(app.profile.progress);
  }

  pushResult({
    action: 'finish',
    deviceId: app.profile.deviceId,
    nickname: app.profile.nickname,
    currentCombinedLevel: app.profile.progress,
    levelName: getLesson(lesson).name,
    gameMode: mode,
    inputMode: app.profile.inputMode === 'novice' ? 'Новачок' : 'Експерт',
    totalQuestions: r.questions, correct: r.correct, errors: r.errors, hintsCount: r.hints,
    score: r.score, time: r.time, speed: r.speed,
    status: r.passed ? 'успіх' : 'невдача',
    bestScore: Math.max(0, ...Object.values(app.profile.records).map(x => x.score || 0)),
    bestSpeed: Math.max(0, ...Object.values(app.profile.records).map(x => x.speed || 0)),
    records: app.profile.records,
  });

  const newBest = better && r.score > 0; // 0 балів — не рекорд
  showResult(r, { newBest, hadOld: Boolean(old), best: app.profile.records[key], idx });
}

function showResult(r, { newBest, hadOld, best, idx }) {
  const mode = getMode(app.sel.mode);
  let icon = '🏁', title = 'Тренування завершено', sub = '';
  if (mode.id === 'speed') {
    [icon, title] = r.passed ? ['🎉', 'Перевірку пройдено!'] : ['💪', 'Майже! Спробуй ще раз'];
  } else if (mode.id === 'records') {
    [icon, title] = newBest ? ['🏆', 'Новий рекорд!'] : ['🏁', 'Марафон завершено'];
    if (!newBest && best?.score > 0) sub = `Твій рекорд: ${best.score} балів`;
  }
  if (newBest && hadOld && mode.id !== 'records') sub = 'Це твій найкращий результат!';

  $('#res-icon').textContent = icon;
  $('#res-title').textContent = title;
  $('#res-subtitle').textContent = sub;
  $('#res-subtitle').hidden = !sub;
  $('#res-score').textContent = r.score;
  $('#res-questions').textContent = r.questions;
  $('#res-correct').textContent = r.correct;
  $('#res-errors').textContent = r.errors;
  $('#res-hints').textContent = r.hints;
  $('#res-time').textContent = fmtTime(r.time);
  $('#res-speed').textContent = `${r.perMinute}/хв`;

  const next = r.passed && idx < SEQUENCE.length - 1 ? parseStage(SEQUENCE[idx + 1]) : null;
  const nextBtn = $('#res-next');
  nextBtn.hidden = !next;
  if (next) nextBtn.textContent = next.lesson !== app.sel.lesson ? `Урок ${next.lesson} →` : `${getMode(next.mode).name} →`;
  nextBtn.onclick = () => { $('#dlg-result').close(); startGame(next.lesson, next.mode); };
  $('#res-retry').classList.toggle('btn--primary', !next);
  $('#res-retry').onclick = () => { $('#dlg-result').close(); startGame(app.sel.lesson, app.sel.mode); };
  $('#res-menu').onclick = () => { $('#dlg-result').close(); app.game = null; openMenu(true); };

  const dlg = $('#dlg-result');
  dlg.showModal();
  if ((r.passed || mode.id === 'records') && newBest && r.score > 0) confetti(dlg);
}
$('#dlg-result').addEventListener('cancel', e => e.preventDefault()); // Esc не закриває без вибору

// ---------- Статистика ----------
function openStats() {
  $('#stats-id').textContent = app.profile.deviceId;
  $('#stats-body').replaceChildren(...LESSONS.map(l => {
    const box = el('section', { className: 'stats__lesson' });
    const rows = MODES.map(m => {
      const r = app.profile.records[recordKey(l.id, m.id)];
      const name = `${m.name}${isPassed(l.id, m.id) ? ' <span class="ok">✓</span>' : ''}`;
      if (!r) return `<div class="stats__row"><span>${name}</span><span class="stats__empty" style="grid-column:span 4">ще не грали</span></div>`;
      return `<div class="stats__row" title="${String(r.date || '').replace(/"/g, '')}"><span>${name}</span><b>${Number(r.score) || 0}</b>
        <span class="ok">${Number(r.correct) || 0}</span><span class="bad">${Number(r.errors) || 0}</span><span>${fmtTime(Number(r.time) || 0)}</span></div>`;
    }).join('');
    box.innerHTML = `<h3>${l.name}</h3><div class="stats__row head"><span>Рівень</span><span>Бали</span><span>Вірно</span><span>Помилки</span><span>Час</span></div>${rows}`;
    return box;
  }));
  $('#dlg-stats').showModal();
}

// ---------- Старт ----------
function boot() {
  if (!app.profile.deviceId) { show('screen-login'); return; }
  openMenu(true);   // одразу показуємо меню з локальних даних…
  sync();           // …а хмару підтягуємо фоном
  // Підвантажити спрайт картинок, поки дитина обирає урок
  (window.requestIdleCallback || setTimeout)(() => { new Image().src = 'assets/tiles.webp'; });
}
boot();
