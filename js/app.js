// Контролер: стан застосунку, екрани, обробка подій.

import { LESSONS, MODES, SEQUENCE, FEEDBACK_MS, ASSETS, getLesson, getMode, modesFor } from './config.js?v=3.16';
import { createGame, makeChoices, isBetter } from './engine.js?v=3.16';
import { storage } from './storage.js?v=3.16';
import { loadProfile, mergeRecords, pushResult, newDeviceId, looksLikeId } from './cloud.js?v=3.16';
import { textHint, storyImage, storyVideo } from './hints.js?v=3.16';
import { confetti } from './confetti.js?v=3.16';
import { neededPieces, recallBank, PRODUCTS, digitQuestions, numberQuestions, makeNumberChoices, storyQuestions } from './pictures.js?v=3.16';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

const MODE_ICONS = { digits: '🔢', numbers: '🧮', stories: '📖', associations: '🧩', remember: '🧠', recall: '🔎', training: '🏋️', speed: '✅', records: '🏃' };
const MODE_RULES = {
  digits: 'Знайомимось із героями-цифрами! Подивись на картинку і натисни цифру, яку вона позначає.',
  numbers: 'Кожна картинка — це двоцифрове число з таблиці множення. Вгадай, яке!',
  stories: 'Подивись історію і прочитай підказку. Потім переклади під числа картинки з історії: хто множить і що вийшло.',
  associations: 'Над числами — картинки-асоціації, відповідь теж обираємо картинкою. Помилка? З’явиться підказка і ще одна спроба, а приклад повернеться трохи згодом.',
  remember: 'Приклад показано картинками. Під кожною картинкою обери її число. Помилка — з’явиться картинка-історія. Граємо, доки всі приклади не будуть розв’язані правильно.',
  recall: 'Приклад показано числами. Переклади під кожне число його картинку: картинку рядка, стовпчика і їх перетину в таблиці. Зайві картинки не чіпай!',
  training: 'Тільки числа. Якщо важко — відкрий підказку: текст, історію, відео або картинки (за такий приклад бал не нараховується).',
  speed: 'Без підказок, 3 життя. Перевірку пройдено, якщо розв’язати всі приклади уроку, не втративши всі життя.',
  records: 'Приклади без кінця — до першої помилки. Побий свій рекорд 🏆! Натисни «Фініш», щоб зупинитися.',
};

const app = {
  profile: storage.load(),
  sel: { lesson: 1, mode: 'associations' },
  game: null,
  recordToBeat: null,
  picks: [null, null, null],   // «Запам’ятай»: вибрані числа
  bank: [],                    // «Пригадай»: картинки внизу
  slots: [null, null, null],   // «Пригадай»: картинки під числами
  active: 0,
  marks: [null, null, null],   // 'ok' | 'bad' для кожного поля після перевірки
  locked: false,
  typed: '',
  tilesOn: false,
  disabledValues: new Set(),
  choices: [],
  timerId: null,
  returnTo: 'map',             // куди повертатись після гри: 'location' | 'menu'
  place: 1,                    // відкрита локація (урок)
};

const ICON_MAP = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>';
const ICON_HOME = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/></svg>';
const kindOf = mode => mode.kind || 'choice';
const isPuzzle = mode => ['remember', 'recall', 'story'].includes(kindOf(mode));
const DIGIT_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(value => ({ value }));

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
  if (id !== 'screen-game') $('#toast').hidden = true;
  if (id !== 'screen-game') { stopTimer(); document.getElementById('story-vid')?.pause(); }
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
    openMap();
    sync({ fromLogin: true });
  } else {
    app.profile = { ...app.profile, deviceId: newDeviceId(), nickname: value, records: {}, progress: SEQUENCE[0] };
    storage.saveProfile(app.profile);
    pushResult({ action: 'register', deviceId: app.profile.deviceId, nickname: value,  // новий рядок у листі «Учні»
      inputMode: app.profile.inputMode === 'novice' ? 'Новачок' : 'Експерт', currentCombinedLevel: SEQUENCE[0] });
    storage.saveRecords({});
    storage.saveProgress(SEQUENCE[0]);
    openMap();
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
  const status = { set textContent(t) { document.querySelectorAll('[data-sync]').forEach(n => { n.textContent = t; }); } };
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
  refreshScreen();
}

// ---------- Меню ----------
function openMenu(resetSelection = true) {
  normalizeProgress();
  if (resetSelection) app.sel = parseStage(app.profile.progress);
  if (!modesFor(app.sel.lesson).some(m => m.id === app.sel.mode)) app.sel.mode = modesFor(app.sel.lesson)[0].id;
  renderMenu();
  show('screen-menu');
}

function renderMenu() {
  const { profile, sel } = app;
  const rec = parseStage(profile.progress);

  const lessons = $('#lesson-list');
  lessons.replaceChildren(...LESSONS.map(l => {
    const b = el('button', { type: 'button', className: 'lesson' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l.id === sel.lesson));
    b.dataset.lesson = l.id;
    b.innerHTML = `<div class="lesson__top"><span class="lesson__num">Урок ${l.id}</span></div>
      <div class="lesson__factors">× ${l.factors.join(', ')}</div>
      <div class="dots">${modesFor(l.id).map(m => `<span class="dot${isPassed(l.id, m.id) ? ' is-done' : ''}" title="${m.name}"></span>`).join('')}</div>`;
    return b;
  }));

  const modes = $('#mode-list');
  modes.replaceChildren(...modesFor(sel.lesson).map(m => {
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
  if (!modesFor(app.sel.lesson).some(m => m.id === app.sel.mode)) app.sel.mode = modesFor(app.sel.lesson)[0].id;
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
document.querySelectorAll('[data-open-stats]').forEach(b => b.addEventListener('click', openStats));
$('#btn-start').addEventListener('click', () => { app.returnTo = 'menu'; startGame(app.sel.lesson, app.sel.mode); });

// ---------- Гра ----------
function startGame(lessonId, modeId) {
  const lesson = getLesson(lessonId), mode = getMode(modeId);
  app.sel = { lesson: lesson.id, mode: mode.id };
  const questions = mode.kind === 'digit' ? digitQuestions() : mode.kind === 'number' ? numberQuestions()
    : mode.kind === 'story' ? storyQuestions(lesson.factors) : null;
  app.game = createGame({ lesson, mode, questions });
  app.tilesOn = mode.tilesOn;
  app.locked = false;

  $('#game-lesson').textContent = mode.kind === 'digit' || mode.kind === 'number'
    ? `Урок ${lesson.id} · ${lesson.place.name}` : `Урок ${lesson.id} · ×${lesson.factors.join(', ')}`;
  $('#game-mode').textContent = `${MODE_ICONS[mode.id]} ${mode.name}`;
  $('#btn-exit').hidden = mode.queue === 'endless';
  $('#btn-finish').hidden = mode.queue !== 'endless';
  $('#game-hearts').hidden = mode.lives <= 1; // одне «життя» (марафон) — сердечка не показуємо
  app.recordToBeat = mode.id === 'records' ? Number(app.profile.records[recordKey(lesson.id, mode.id)]?.score) || 0 : null;
  $('#game-record').hidden = app.recordToBeat === null;
  $('#game-record').classList.remove('is-beaten');
  $('#game-record-val').textContent = app.recordToBeat ?? 0;
  $('#game-progress').hidden = mode.queue === 'endless';
  const kind = kindOf(mode);
  const typed = app.profile.inputMode === 'expert';
  $('#choices').hidden = isPuzzle(mode) || (kind !== 'digit' && typed);   // цифри 0–9 — завжди кнопками
  $('#choices').classList.toggle('choices--digits', kind === 'digit');
  $('#keypad-wrap').hidden = isPuzzle(mode) || kind === 'digit' || !typed;
  $('#puzzle').hidden = !isPuzzle(mode);
  $('#expr').classList.toggle('expr--puzzle', isPuzzle(mode));
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
  const kind = kindOf(app.game.mode);
  app.choices = kind === 'digit' ? DIGIT_CHOICES : kind === 'number' ? makeNumberChoices(q) : makeChoices(q);
  app.picks = [null, null, null];
  app.slots = [null, null, null];
  app.marks = [null, null, null];
  app.active = 0;
  app.bank = ['recall', 'story'].includes(app.game.mode.kind) ? recallBank(q) : [];
  $('#question').classList.remove('is-right', 'is-wrong');
  hideHints();
  // Підказка «картинки» в тренуванні діє лише на один приклад
  if (app.game.mode.id === 'training') app.tilesOn = false;
  if (app.game.mode.kind === 'story') { showText(q); showVideo(q) || showStory(q); } // історія видна весь час
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
  updateHintButtons(q);
  if (isPuzzle(app.game.mode)) { renderPuzzle(reveal); return; }
  if (q.pic) { renderPicture(q, reveal); return; }
  const picturesOnly = app.game.mode.id === 'associations'; // в асоціаціях — лише картинки, без цифр
  const num = n => (picturesOnly ? `<span class="factor factor--big">${tileHTML(n, 1)}</span>`
    : app.tilesOn ? `<span class="factor">${tileHTML(n, 1)}<span>${n}</span></span>` : `<span>${n}</span>`);
  const ans = reveal ? q.answer : (app.profile.inputMode === 'expert' && app.typed ? app.typed : '?');
  $('#expr').innerHTML = `${num(q.a)}<span class="op">×</span>${num(q.b)}<span class="op">=</span><span class="ans${reveal ? ' reveal' : ''}">${ans}</span>`;
  $('#expr').setAttribute('aria-label', `${q.a} помножити на ${q.b}`);

  if (app.profile.inputMode === 'novice') renderChoices();
}

/** «Вгадай цифру» і «Вгадай число»: велика картинка = ? */
function renderPicture(q, reveal) {
  const ans = reveal ? q.answer : (app.typed || '?');
  $('#expr').innerHTML = `<span class="factor factor--huge">${tileHTML(q.pic[0], q.pic[1])}</span>
    <span class="op">=</span><span class="ans${reveal ? ' reveal' : ''}">${ans}</span>`;
  $('#expr').setAttribute('aria-label', 'Яке число на картинці?');
  if (!$('#choices').hidden) renderChoices();
}

/** Які кнопки підказок доступні для цього прикладу. */
function updateHintButtons(q) {
  const hints = app.game.mode.hints;
  $('#hint-bar [data-hint="text"]').hidden = !hints.includes('text') || !textHint(q.a, q.b);
  $('#hint-bar [data-hint="story"]').hidden = !hints.includes('story') || !storyImage(q.a, q.b);
  $('#hint-bar [data-hint="video"]').hidden = !hints.includes('video') || !storyVideo(q.a, q.b);
  $('#hint-bar [data-hint="tiles"]').setAttribute('aria-pressed', String(app.tilesOn));
}

// ---------- «Запам’ятай» і «Пригадай» ----------
const FACTORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const markCls = i => (app.marks[i] ? ` is-${app.marks[i]}` : '');

function renderPuzzle(reveal = false) {
  const q = app.game.question;
  const kind = app.game.mode.kind;
  const off = reveal || app.locked;

  if (kind === 'remember') {
    const pieces = neededPieces(q);
    const lists = [FACTORS, FACTORS, PRODUCTS];
    const labels = ['перше число', 'друге число', 'відповідь'];
    const col = i => {
      const opts = `<option value="" disabled${app.picks[i] === null ? ' selected' : ''}>?</option>`
        + lists[i].map(n => `<option value="${n}"${app.picks[i] === n ? ' selected' : ''}>${n}</option>`).join('');
      return `<div class="pz-col${markCls(i)}">${tileHTML(pieces[i].r, pieces[i].c)}
        <select data-pick="${i}" aria-label="${labels[i]}"${off ? ' disabled' : ''}>${opts}</select></div>`;
    };
    $('#expr').innerHTML = `${col(0)}<span class="op">×</span>${col(1)}<span class="op">=</span>${col(2)}`;
    $('#puzzle').innerHTML = `<button class="btn btn--primary btn--block" type="button" data-check
      ${off || app.picks.includes(null) ? 'disabled' : ''}>Перевірити</button>`;
  } else {
    const nums = [q.a, q.b, reveal ? q.answer : '?'];
    const col = i => {
      const p = app.slots[i];
      const active = !off && i === app.active && !p ? ' is-active' : '';
      return `<div class="pz-col${markCls(i)}"><span class="pz-num${i === 2 && reveal ? ' reveal' : ''}">${nums[i]}</span>
        <button type="button" class="drop${active}" data-slot="${i}" aria-label="Місце для картинки"${off ? ' disabled' : ''}>
        ${p ? tileHTML(p.r, p.c) : ''}</button></div>`;
    };
    $('#expr').innerHTML = `${col(0)}<span class="op">×</span>${col(1)}<span class="op">=</span>${col(2)}`;
    const placed = new Set(app.slots.filter(Boolean).map(p => p.id));
    $('#puzzle').innerHTML = `<div class="bank">${app.bank.map(p => `<button type="button" class="bank__item"
      data-piece="${p.id}"${placed.has(p.id) ? ' hidden' : ''}${off ? ' disabled' : ''}>${tileHTML(p.r, p.c)}</button>`).join('')}</div>
      <button class="btn btn--primary btn--block" type="button" data-check ${off || app.slots.includes(null) ? 'disabled' : ''}>Перевірити</button>`;
  }
}

const firstEmpty = () => { const i = app.slots.indexOf(null); return i === -1 ? app.active : i; };

$('#expr').addEventListener('change', e => {
  const s = e.target.closest('[data-pick]');
  if (!s || app.locked) return;
  const i = Number(s.dataset.pick);
  app.picks[i] = Number(s.value);
  app.marks[i] = null;
  renderPuzzle();
});

$('#expr').addEventListener('click', e => {
  const d = e.target.closest('[data-slot]');
  if (!d || app.locked) return;
  const i = Number(d.dataset.slot);
  if (app.slots[i]) { app.slots[i] = null; app.marks[i] = null; } // повернути картинку вниз
  app.active = i;
  renderPuzzle();
});

$('#puzzle').addEventListener('click', e => {
  if (app.locked) return;
  if (e.target.closest('[data-check]')) { checkPuzzle(); return; }
  const b = e.target.closest('[data-piece]');
  if (!b) return;
  const piece = app.bank.find(p => p.id === Number(b.dataset.piece));
  const i = app.slots[app.active] ? firstEmpty() : app.active;
  app.slots[i] = piece;
  app.marks[i] = null;
  app.active = firstEmpty();
  renderPuzzle();
});

function checkPuzzle() {
  const q = app.game.question;
  if (!q || app.locked) return;
  const ok = app.game.mode.kind === 'remember'
    ? [q.a, q.b, q.answer].map((v, i) => app.picks[i] === v)
    : neededPieces(q).map((need, i) => app.slots[i]?.pid === need.pid);
  const right = ok.every(Boolean);
  app.locked = true;
  app.marks = ok.map(x => (x ? 'ok' : 'bad'));
  const res = app.game.judge(right);
  const card = $('#question');
  card.classList.remove('is-right', 'is-wrong');
  void card.offsetWidth;
  card.classList.add(right ? 'is-right' : 'is-wrong');
  renderHud();
  renderPuzzle(right);

  if (right) { setTimeout(nextQuestion, FEEDBACK_MS.right + 300); return; }
  setTimeout(() => {
    // неправильні поля очищаємо, правильні лишаються зеленими
    ok.forEach((x, i) => { if (!x) { app.picks[i] = null; app.slots[i] = null; app.marks[i] = null; } });
    app.active = firstEmpty();
    card.classList.remove('is-wrong');
    app.locked = false;
    showAutoHint();
    if (res.then !== 'retry') nextQuestion(); else renderPuzzle();
  }, FEEDBACK_MS.wrong);
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
  if (app.recordToBeat !== null) {
    const beaten = g.stats.score > app.recordToBeat;
    $('#game-record').classList.toggle('is-beaten', beaten);
    $('#game-record').title = beaten ? 'Рекорд побито!' : 'Рекорд, який треба побити';
  }
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
    if (!$('#choices').hidden) { app.disabledValues.add(value); renderChoices(null, value); }
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
  if (!$('#choices').hidden) renderChoices(res.correctAnswer, value);
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
  if (!app.game || isPuzzle(app.game.mode)) return; // у «Запам’ятай» і «Пригадай» — лише мишка/дотик
  if (kindOf(app.game.mode) === 'digit') {
    const b = /^\d$/.test(e.key) && $(`#choices .choice[data-value="${e.key}"]`);
    if (b && !b.disabled) submit(Number(e.key), b);
  } else if (app.profile.inputMode === 'expert') {
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
  stopStoryVideo();
  $('#hint-bar [data-hint="text"]').setAttribute('aria-pressed', 'false');
  $('#hint-bar [data-hint="story"]').setAttribute('aria-pressed', 'false');
  $('#hint-bar [data-hint="video"]').setAttribute('aria-pressed', 'false');
}

function showText(q) {
  const t = textHint(q.a, q.b);
  if (!t) return false;
  $('#text-hint').textContent = t;
  $('#text-hint').hidden = false;
  $('#hint-bar [data-hint="text"]').setAttribute('aria-pressed', 'true');
  return true;
}
/** Відео-історія (у рівні «Історії» і як підказка «Відео»). */
function showVideo(q) {
  const vsrc = storyVideo(q.a, q.b);
  if (!vsrc) return false;
  playStoryVideo(vsrc, storyImage(q.a, q.b));
  $('#hint-bar [data-hint="video"]').setAttribute('aria-pressed', 'true');
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

// ---------- Відео-історії (зі звуком) ----------
// Браузер може не дозволити звук без натискання — тоді граємо без звуку і показуємо кнопку «Увімкнути звук».
const vid = $('#story-vid');
function playStoryVideo(vsrc, poster) {
  $('#story').hidden = true;
  $('#story-video').hidden = false;
  $('#story-replay').hidden = true;
  vid.poster = poster || '';
  vid.onerror = () => { stopStoryVideo(); if (poster) { $('#story').src = poster; $('#story').hidden = false; } };
  if (vid.dataset.src !== vsrc) { vid.src = `${vsrc}?v=3.16`; vid.dataset.src = vsrc; }
  try { vid.currentTime = 0; } catch { /* ще не завантажено */ }
  vid.muted = false;
  vid.play().then(() => { $('#story-sound').hidden = true; }).catch(() => {
    vid.muted = true;
    $('#story-sound').hidden = false;
    vid.play().catch(() => {});
  });
}
function stopStoryVideo() {
  vid.pause();
  $('#story-video').hidden = true;
}
vid.addEventListener('ended', () => { $('#story-replay').hidden = false; });
const replayVideo = () => { $('#story-replay').hidden = true; vid.currentTime = 0; vid.play().catch(() => {}); };
vid.addEventListener('click', replayVideo);
$('#story-replay').addEventListener('click', replayVideo);
$('#story-sound').addEventListener('click', () => {
  vid.muted = false;
  $('#story-sound').hidden = true;
  replayVideo();
});

/** Підказка після помилки — не рахується як «взята», бал за приклад і так втрачено. */
function showAutoHint() {
  const q = app.game.question;
  hideHints();
  if (q.pic) return; // у «Вгадай цифру/число» підказок немає
  if (app.game.mode.kind === 'story') { showText(q); showVideo(q) || showStory(q); return; }
  if (app.game.mode.errorHint === 'story') { if (!showStory(q)) showText(q); }
  else if (!showText(q)) showStory(q);
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
  hideHints(); // одночасно показуємо лише одну: текст, картинку або відео
  if (wasOn) return;
  const shown = kind === 'text' ? showText(q) : kind === 'video' ? showVideo(q) : showStory(q);
  if (shown) app.game.useHint();
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

$('#btn-exit').addEventListener('click', () => { app.game = null; goBack(); });
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
  showResult(r, { newBest, oldScore: old?.score ?? null, idx });
}

/** Українська множина: plural(5, ['відповідь','відповіді','відповідей']) */
const plural = (n, [one, few, many]) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Що показати у вікні результату: одне велике число + один-два підписані показники. */
function resultView(r, mode, { newBest, oldScore }) {
  const stat = (caption, value) => ({ caption, value });
  const speed = stat('швидкість', `⚡ ${r.perMinute} за хвилину`);
  const v = { icon: '🎉', title: 'Молодець!', main: '', label: '', record: '', recordGood: false, stats: [] };

  if (mode.id === 'records') {                                      // Марафон: правильні відповіді + швидкість
    Object.assign(v, { main: r.correct, stats: [speed] });
    if (newBest) Object.assign(v, { icon: '🏆', title: 'Новий рекорд!' });
    else Object.assign(v, { icon: '🏁', title: 'Марафон завершено',
      record: oldScore > 0 ? `Рекорд — ${oldScore}. Цього разу не вдалося побити, спробуй ще!` : '' });
  } else if (mode.id === 'speed') {                                 // Перевірка: скільки правильно + швидкість
    Object.assign(v, { main: `${r.correct}/${r.questions}`, label: 'правильно', stats: [speed] });
    if (r.passed) Object.assign(v, { icon: '🎉', title: 'Перевірку пройдено!' });
    else Object.assign(v, { icon: '💪', title: 'Майже! Спробуй ще раз', record: 'Закінчились життя — 3 помилки' });
  } else {
    // Навчальні рівні: важливо, що рівень завершено, скільки тривало навчання, скільки було питань, помилок і підказок
    const titles = { training: 'Тренування успішно завершено!', associations: 'Асоціації вивчено!', stories: 'Історії пройдено!',
      remember: 'Рівень пройдено!', recall: 'Рівень пройдено!', digits: 'Усі цифри вгадано!', numbers: 'Усі числа вгадано!' };
    Object.assign(v, { icon: r.errors || r.hints ? '🎉' : '🌟', title: titles[mode.id] || 'Рівень пройдено!',
      main: fmtTime(r.time), label: 'тривалість' });
    v.stats.push(stat(isPuzzle(mode) ? 'прикладів' : 'питань', `❓ ${r.questions}`));
    v.stats.push(stat('помилок', `✏️ ${r.errors}`));
    if (mode.hints?.length) v.stats.push(stat('підказок', `💡 ${r.hints}`));
  }
  return v;
}

function showResult(r, { newBest, oldScore, idx }) {
  const mode = getMode(app.sel.mode);
  const v = resultView(r, mode, { newBest, oldScore });
  $('#res-icon').textContent = v.icon;
  $('#res-title').textContent = v.title;
  $('#res-main').textContent = v.main;
  $('#res-label').textContent = v.label;
  $('#res-label').hidden = !v.label;
  const rec = $('#res-record');
  rec.textContent = v.record;
  rec.hidden = !v.record;
  rec.classList.toggle('is-good', v.recordGood);
  $('#res-stats').replaceChildren(...v.stats.map(st => el('div', { className: 'result__stat' }, `<small>${st.caption}</small><span class="chip">${st.value}</span>`)));

  const dip = $('#res-diploma');
  dip.hidden = !(mode.id === 'records' && r.passed);
  dip.parentElement.classList.toggle('has-diploma', !dip.hidden);               // диплом — у кінці уроку, після марафону (від 1 бала)
  dip.onclick = () => openDiploma();

  const next = r.passed && idx < SEQUENCE.length - 1 ? parseStage(SEQUENCE[idx + 1]) : null;
  const nextBtn = $('#res-next');
  nextBtn.hidden = !next;
  if (next) nextBtn.textContent = next.lesson !== app.sel.lesson ? `Урок ${next.lesson} →` : `${getMode(next.mode).name} →`;
  nextBtn.onclick = () => { $('#dlg-result').close(); startGame(next.lesson, next.mode); };
  $('#res-retry').classList.toggle('btn--primary', !next);
  $('#res-retry').onclick = () => { $('#dlg-result').close(); startGame(app.sel.lesson, app.sel.mode); };
  const toMenu = app.returnTo === 'menu';
  $('#res-menu').innerHTML = toMenu ? ICON_HOME : ICON_MAP;
  $('#res-menu').setAttribute('aria-label', toMenu ? 'Меню' : 'До рівнів');
  $('#res-menu').title = toMenu ? 'Меню' : 'До рівнів';
  $('#res-menu').onclick = () => { $('#dlg-result').close(); app.game = null; goBack(); };

  const dlg = $('#dlg-result');
  dlg.showModal();
  if ((r.passed || mode.id === 'records') && newBest && r.score > 0) confetti(dlg);
}

// ---------- Диплом ----------
async function openDiploma() {
  const lesson = getLesson(app.sel.lesson);
  const name = app.profile.nickname || 'Учень';
  const title = `«${lesson.place.name}»`;
  const subtitle = lesson.name;

  const date = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  const box = $('#diploma-preview'), btn = $('#diploma-pdf');
  box.innerHTML = '<span class="muted">Малюю диплом…</span>';
  btn.disabled = true;
  $('#dlg-diploma').showModal();
  try {
    const { drawDiploma, canvasToPdf } = await import('./diploma.js?v=3.16');
    const canvas = await drawDiploma({ name, title, subtitle, heroes: lesson.factors, date, id: app.profile.deviceId });
    const img = el('img', { src: canvas.toDataURL('image/jpeg', 0.85), alt: `Диплом: ${name}` });
    box.replaceChildren(img);
    btn.disabled = false;
    btn.onclick = async () => {
      const blob = await canvasToPdf(canvas);
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `Диплом — ${name}.pdf` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
  } catch {
    box.innerHTML = '<span class="muted">Не вдалося намалювати диплом. Спробуй ще раз.</span>';
  }
}

$('#dlg-result').addEventListener('cancel', e => e.preventDefault()); // Esc не закриває без вибору

// ---------- Статистика ----------
function openStats() {
  $('#stats-id').textContent = app.profile.deviceId;
  $('#stats-body').replaceChildren(...LESSONS.map(l => {
    const box = el('section', { className: 'stats__lesson' });
    const rows = modesFor(l.id).map(m => {
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

// ---------- Карта уроків і локації ----------
// Координати у відсотках сцени: карта 3:4 (локації зліва направо), локація 3:5 (рівні знизу вгору).
// Точки підібрано під картинку фону: бухта з маяком, острів метеликів, лука біля равлика, лука під замком
const MAP_POINTS = [[16, 79], [40, 48], [62, 76], [78, 37]];
const MAP_TRAIL_START = [6, 98];
const levelPoints = n => Array.from({ length: n }, (_, i) => [
  50 + 30 * Math.sin((i * Math.PI) / 2),            // змійка: центр → право → центр → ліво
  n === 1 ? 50 : 85 - (i * 75) / (n - 1),            // знизу вгору
]);

const hasArt = name => ASSETS.art.includes(name);
const artImg = (name, alt = '') => `<img src="${ASSETS.artUrl(name)}?v=3.16" alt="${alt}" loading="lazy" decoding="async">`;
const stageIdx = (lesson, mode) => SEQUENCE.indexOf(stageKey(lesson, mode));
const progressIdx = () => Math.max(0, SEQUENCE.indexOf(app.profile.progress));

function updateUser() {
  const name = app.profile.nickname || 'Учень';
  document.querySelectorAll('[data-user-name]').forEach(n => { n.textContent = name; });
  document.querySelectorAll('[data-user-avatar]').forEach(n => { n.textContent = name.trim()[0]?.toUpperCase() || '?'; });
  document.querySelectorAll('[data-sync]').forEach(n => { if (!n.textContent) n.textContent = '💾 Збережено на пристрої'; });
}

// Вигляд доріжки: 'stones' — камінці, 'bubbles' — бульбашки, 'arrows' — стрілочки
const TRAIL_STYLE = 'stones';
const TRAIL_STEP = 13;   // відстань між камінцями (в одиницях viewBox)
const TRAIL_GAP = 20;    // скільки лишити вільним біля значка рівня/локації

/** Точки, рівномірно розставлені вздовж відрізка-кривої (Catmull-Rom → Безьє), з напрямком руху. */
function trailDots(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    const bez = t => [0, 1].map(k => (1 - t) ** 3 * p1[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * p2[k]);
    const samples = [];
    let len = 0, prev = bez(0);
    for (let s = 0; s <= 200; s++) {
      const p = bez(s / 200);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      samples.push({ p, len }); prev = p;
    }
    const usable = len - 2 * TRAIL_GAP;
    if (usable <= 0) continue;
    const n = Math.max(1, Math.round(usable / TRAIL_STEP));
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const at = TRAIL_GAP + (usable * k) / n;
      while (j < samples.length - 1 && samples[j].len < at) j++;
      const a = samples[Math.max(0, j - 1)].p, b = samples[j].p;
      out.push({ x: b[0], y: b[1], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, seg: i, k });
    }
  }
  return out;
}

function trailMark(d, done) {
  const x = d.x.toFixed(1), y = d.y.toFixed(1), c = done ? ' is-done' : '';
  if (TRAIL_STYLE === 'arrows') {
    return `<path class="trail__arrow${c}" transform="translate(${x} ${y}) rotate(${d.ang.toFixed(0)})" d="M-3 -4.5 L3 0 L-3 4.5"/>`;
  }
  if (TRAIL_STYLE === 'bubbles') {
    const r = [4.6, 3.4, 5.2, 3.8][d.k % 4];
    return `<g class="trail__bubble${c}" transform="translate(${x} ${y})"><circle r="${r}"/><circle class="shine" cx="${(-r * 0.35).toFixed(1)}" cy="${(-r * 0.35).toFixed(1)}" r="${(r * 0.3).toFixed(1)}"/></g>`;
  }
  // камінці: трохи різні за розміром, поворотом і зсувом убік — щоб виглядали природно
  const side = (d.k % 2 ? 1 : -1) * 2, rad = (d.ang + 90) * Math.PI / 180;
  const sx = (d.x + side * Math.cos(rad)).toFixed(1), sy = (d.y + side * Math.sin(rad)).toFixed(1);
  const rx = [5.6, 4.8, 5.2][d.k % 3], ry = [4, 3.6, 4.2][d.k % 3];
  return `<ellipse class="trail__stone${c}" cx="${sx}" cy="${sy}" rx="${rx}" ry="${ry}" transform="rotate(${(d.ang + [8, -14, 4][d.k % 3]).toFixed(0)} ${sx} ${sy})"/>`;
}

function trailSVG(pctPoints, w, h, doneSegs) {
  const pts = pctPoints.map(([x, y]) => [Math.round(x * w / 100), Math.round(y * h / 100)]);
  const marks = trailDots(pts).map(d => trailMark(d, d.seg < doneSegs)).join('');
  return `<svg class="trail trail--${TRAIL_STYLE}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${marks}</svg>`;
}

function stageBackground(stage, artName, sky, ground) {
  stage.style.setProperty('--sky', sky);
  stage.style.setProperty('--ground', ground);
  stage.querySelector('.stage__bg').innerHTML = hasArt(artName) ? artImg(artName) : '';
}

function openMap() {
  normalizeProgress();
  updateUser();
  renderMap();
  show('screen-map');
}

function renderMap() {
  const cur = parseStage(app.profile.progress).lesson;
  const stage = $('#map-stage');
  stageBackground(stage, 'map-bg', '#bfe6ff', '#9fd889');
  const done = LESSONS.filter(l => modesFor(l.id).every(m => isPassed(l.id, m.id))).length;
  stage.querySelector('.stage__trail').innerHTML =
    trailSVG([MAP_TRAIL_START, ...MAP_POINTS], 300, 400, Math.min(cur, LESSONS.length));
  stage.querySelector('.stage__nodes').replaceChildren(...LESSONS.map((l, i) => {
    const modes = modesFor(l.id);
    const passed = modes.filter(m => isPassed(l.id, m.id)).length;
    const locked = stageIdx(l.id, modes[0].id) > progressIdx();
    const b = el('button', { type: 'button', className: `node node--place${locked ? ' is-locked' : ''}${l.id === cur ? ' is-current' : ''}${passed === modes.length ? ' is-done' : ''}` });
    b.style.left = `${MAP_POINTS[i][0]}%`;
    b.style.top = `${MAP_POINTS[i][1]}%`;
    b.dataset.place = l.id;
    b.setAttribute('aria-label', `Урок ${l.id}: ${l.place.name}${locked ? ' (закрито)' : ''}`);
    const badge = hasArt(`loc${l.id}`) ? artImg(`loc${l.id}`, l.place.name) : tileHTML(l.place.tile, 1);
    b.innerHTML = `${l.id === cur ? `<span class="pin"><span>${$('[data-user-avatar]').textContent}</span></span>` : ''}
      <span class="node__badge" style="--ring:${l.place.ground}">${badge}${locked ? '<span class="node__lock">🔒</span>' : ''}</span>
      <span class="node__label"><b>${l.place.name}</b><small>Урок ${l.id} · ${passed}/${modes.length} ⭐</small></span>`;
    return b;
  }));
  $('#map-note').textContent = done === LESSONS.length ? '🏆 Усі уроки пройдено!' : 'Іди доріжкою зліва направо — від уроку до уроку';
}

$('#map-stage').addEventListener('click', e => {
  const b = e.target.closest('[data-place]');
  if (!b) return;
  const id = Number(b.dataset.place);
  if (b.classList.contains('is-locked')) { toast(`Спочатку пройди «${getLesson(id - 1).place.name}» 🔒`); return; }
  openLocation(id);
});
$('#btn-settings').addEventListener('click', () => openMenu(true));
$('#btn-menu-back').addEventListener('click', openMap);
$('#btn-place-back').addEventListener('click', openMap);

function openLocation(id) {
  normalizeProgress();
  app.place = id;
  renderLocation();
  show('screen-location');
}

function renderLocation() {
  const l = getLesson(app.place);
  const modes = modesFor(l.id);
  const pIdx = progressIdx();
  const passed = modes.filter(m => isPassed(l.id, m.id)).length;
  $('#place-title').textContent = l.place.name;
  $('#place-sub').textContent = `Урок ${l.id} · ×${l.factors.join(', ')} · ${passed}/${modes.length} ⭐`;
  const stage = $('#place-stage');
  stageBackground(stage, `loc${l.id}-bg`, l.place.sky, l.place.ground);
  const pts = levelPoints(modes.length);
  const doneSegs = modes.findIndex(m => stageIdx(l.id, m.id) >= pIdx);
  stage.querySelector('.stage__trail').innerHTML =
    trailSVG(pts, 300, 500, doneSegs === -1 ? modes.length : doneSegs);
  stage.querySelector('.stage__nodes').replaceChildren(...modes.map((m, i) => {
    const idx = stageIdx(l.id, m.id);
    const state = isPassed(l.id, m.id) ? 'is-done' : idx === pIdx ? 'is-current' : idx > pIdx ? 'is-locked' : '';
    const b = el('button', { type: 'button', className: `node node--level ${state}` });
    b.style.left = `${pts[i][0]}%`;
    b.style.top = `${pts[i][1]}%`;
    b.dataset.mode = m.id;
    b.setAttribute('aria-label', `${i + 1}. ${m.name}`);
    const icon = hasArt(`lvl-${m.id}`) ? artImg(`lvl-${m.id}`, m.name) : `<span class="node__emoji">${MODE_ICONS[m.id]}</span>`;
    const mark = state === 'is-done' ? '<span class="node__mark">✓</span>' : state === 'is-locked' ? '<span class="node__lock">🔒</span>' : '';
    b.innerHTML = `<span class="node__badge" style="--ring:${l.place.ground}">${icon}${mark}<span class="node__num">${i + 1}</span></span>
      <span class="node__label"><b>${m.name}</b></span>`;
    return b;
  }));
}

$('#place-stage').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  if (b.classList.contains('is-locked')) { toast('Цей рівень відкриється, коли пройдеш попередній 🔒'); return; }
  app.returnTo = 'location';
  toast(MODE_RULES[b.dataset.mode], 3000);
  startGame(app.place, b.dataset.mode);
});

/** Повернутись туди, звідки почали гру. */
function goBack() {
  if (app.returnTo === 'location') { app.place = app.sel.lesson; openLocation(app.place); }
  else if (app.returnTo === 'menu') openMenu(false);
  else openMap();
}

/** Перемалювати відкритий екран (після синхронізації з хмарою). */
function refreshScreen() {
  updateUser();
  if (!$('#screen-map').hidden) renderMap();
  else if (!$('#screen-location').hidden) renderLocation();
  else if (!$('#screen-menu').hidden) renderMenu();
}

// ---------- Старт ----------
function boot() {
  if (!app.profile.deviceId) { show('screen-login'); return; }
  openMap();        // одразу показуємо карту з локальних даних…
  sync();           // …а хмару підтягуємо фоном
  // Підвантажити спрайт картинок, поки дитина обирає урок
  (window.requestIdleCallback || setTimeout)(() => { new Image().src = 'assets/tiles.webp?v=3.16'; });
}
boot();
