// Контролер: стан застосунку, екрани, обробка подій.

import { LESSONS, MODES, SEQUENCE, FEEDBACK_MS, ASSETS, COURSE_LESSONS, getLesson, getMode, modesFor } from './config.js?v=3.81';
import { createGame, makeChoices, isBetter } from './engine.js?v=3.81';
import { storage } from './storage.js?v=3.81';
import { loadProfile, pushResult, newDeviceId, looksLikeId, shareCode } from './cloud.js?v=3.81';
import { textHint, storyImage, storyVideo } from './hints.js?v=3.81';
import { createMapView } from './mapview.js?v=3.81';
import { confetti } from './confetti.js?v=3.81';
import { neededPieces, recallBank, PRODUCTS, guessQuestions, makeGuessChoices, storyQuestions, examQuestions } from './pictures.js?v=3.81';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

const MODE_ICONS = { guess: '🔢', stories: '📖', associations: '🧩', remember: '🧠', recall: '🔎', training: '🏋️', speed: '✅', records: '🏃', exam: '🎓' };
const MODE_RULES = {
  guess: 'Знайомимось із новими картинками уроку! Кожна картинка — це число: герой-цифра або відповідь з таблиці. Вгадай, яке!',
  stories: 'Подивись відео-історію до кінця. Потім переклади під числа картинки з історії: хто множить і що вийшло.',
  associations: 'Над числами — картинки-асоціації, відповідь теж обираємо картинкою. Помилка? З’явиться підказка і ще одна спроба, а приклад повернеться трохи згодом.',
  remember: 'Приклад показано картинками. Під кожною картинкою обери її число. Помилка — з’явиться картинка-історія. Граємо, доки всі приклади не будуть розв’язані правильно.',
  recall: 'Приклад показано числами. Переклади під кожне число його картинку: картинку рядка, стовпчика і їх перетину в таблиці. Зайві картинки не чіпай!',
  training: 'Тільки числа. Якщо важко — відкрий підказку: текст, історію, відео або картинки (за такий приклад бал не нараховується).',
  speed: 'Без підказок, 3 життя. Перевірку пройдено, якщо розв’язати всі приклади уроку, не втративши всі життя.',
  records: 'Приклади без кінця — до першої помилки. Побий свій рекорд 🏆! Натисни «Фініш», щоб зупинитися.',
  exam: 'Уся таблиця множення: 81 приклад, кожен один раз. Відповідь набирай сам, без варіантів і підказок. Зелена кулька — правильно, червона — помилка. Удачі! 🍀',
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
/** Відповідь набирається з клавіатури: режим «Набрати» або екзамен (там завжди без варіантів). */
const typedInput = () => app.game?.mode.kind === 'exam' || app.profile.inputMode === 'expert';
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
  // зі старої версії: «Вгадай цифру» + «Вгадай число» в уроці 1 = новий рівень «Вгадай число»
  if (mode === 'guess' && Number(lesson) === 1 && !app.profile.records.L1_guess
    && app.profile.records.L1_digits && app.profile.records.L1_numbers) return true;
  const r = app.profile.records[recordKey(lesson, mode)];
  return Boolean(r && r.passed !== false); // старі записи без поля passed вважаємо пройденими
};

/**
 * Поточний етап НЕ зберігається окремо — він завжди обчислюється з пройдених рівнів:
 * наступний після останнього пройденого. Тож якщо в таблиці видалити рядки гри, прогрес відкотиться.
 */
function normalizeProgress() {
  let idx = 0;
  SEQUENCE.forEach((s, i) => {
    const { lesson, mode } = parseStage(s);
    if (isPassed(lesson, mode)) idx = Math.max(idx, Math.min(i + 1, SEQUENCE.length - 1));
  });
  app.profile.progress = SEQUENCE[idx];
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
      inputMode: app.profile.inputMode === 'novice' ? 'Новачок' : 'Експерт', avatar: app.profile.avatar });
    storage.saveRecords({});
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
  try { await navigator.clipboard.writeText(app.profile.deviceId); toast('Пароль скопійовано'); }
  catch { toast('Не вдалося скопіювати — виділи пароль вручну'); }
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
  if (remote.notFound && fromLogin) {
    status.textContent = '⚠️ Учня не знайдено';
    toast('Учня з таким паролем не знайдено. Перевір пароль.');
    return;
  }
  const p = app.profile;
  // Джерело правди — журнал ігор у таблиці (лист «Статистика»). Локальні рекорди — лише кеш, їх замінюємо.
  p.records = remote.records;
  if (remote.nickname && (fromLogin || !p.nickname)) p.nickname = remote.nickname;
  if (fromLogin && remote.inputMode) p.inputMode = remote.inputMode;
  if (remote.avatar !== null) { p.avatar = remote.avatar; p.photo = remote.photo; storage.saveAvatar(p); }
  else if (p.avatar !== '13' || p.photo) pushProfile();   // таблиця ще не знає аватарку — надіслати
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
    const b = el('button', { type: 'button', className: `lesson${l.exam ? ' lesson--wide' : ''}` });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l.id === sel.lesson));
    b.dataset.lesson = l.id;
    b.innerHTML = `<div class="lesson__top"><span class="lesson__num">${l.exam ? '🎓 Екзамен' : `Урок ${l.id}`}</span></div>
      <div class="lesson__factors">${l.exam ? '1×1 … 9×9' : `× ${l.factors.join(', ')}`}</div>
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
  const questions = mode.kind === 'guess' ? guessQuestions(LESSONS, lesson.id)
    : mode.kind === 'story' ? storyQuestions(lesson.factors) : mode.kind === 'exam' ? examQuestions() : null;
  app.game = createGame({ lesson, mode, questions });
  app.tilesOn = mode.tilesOn;
  app.locked = false;

  $('#game-lesson').textContent = lesson.exam ? 'Уся таблиця множення' : mode.kind === 'guess'
    ? `Урок ${lesson.id} · ${lesson.place.name}` : `Урок ${lesson.id} · ×${lesson.factors.join(', ')}`;
  $('#game-mode').textContent = `${MODE_ICONS[mode.id]} ${mode.name}`;
  $('#btn-exit').hidden = mode.queue === 'endless';
  $('#btn-finish').hidden = mode.queue !== 'endless';
  $('#game-hearts').hidden = mode.lives <= 1; // одне «життя» (марафон) — сердечка не показуємо
  app.recordToBeat = mode.id === 'records' ? Number(app.profile.records[recordKey(lesson.id, mode.id)]?.score) || 0 : null;
  $('#game-record').hidden = app.recordToBeat === null;
  $('#game-record').classList.remove('is-beaten');
  $('#game-record-val').textContent = app.recordToBeat ?? 0;
  const exam = mode.kind === 'exam';
  $('#game-progress').hidden = mode.queue === 'endless' || exam;
  $('#exam-bar').hidden = !exam;
  $('#game-timer').hidden = exam;            // в екзамені таймер — над кульками
  app.examMarks = [];
  const kind = kindOf(mode);
  const typed = typedInput();
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
  app.choices = kind === 'digit' ? DIGIT_CHOICES : kind === 'guess' ? makeGuessChoices(q) : makeChoices(q);
  app.picks = [null, null, null];
  app.slots = [null, null, null];
  app.marks = [null, null, null];
  app.active = 0;
  app.bank = ['recall', 'story'].includes(app.game.mode.kind) ? recallBank(q) : [];
  $('#question').classList.remove('is-right', 'is-wrong');
  hideHints();
  // Підказка «картинки» в тренуванні діє лише на один приклад
  if (app.game.mode.id === 'training') app.tilesOn = false;
  // «Історії»: лише відео (або картинка), без тексту. Поки відео йде вперше — «Перевірити» неактивна
  app.storyWatching = false;
  if (app.game.mode.kind === 'story') { app.storyWatching = showVideo(q); if (!app.storyWatching) showStory(q); }
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
  const ans = reveal ? q.answer : (typedInput() && app.typed ? app.typed : '?');
  $('#expr').innerHTML = `${num(q.a)}<span class="op">×</span>${num(q.b)}<span class="op">=</span><span class="ans${reveal ? ' reveal' : ''}">${ans}</span>`;
  $('#expr').setAttribute('aria-label', `${q.a} помножити на ${q.b}`);

  if (!typedInput()) renderChoices();
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
      <button class="btn btn--primary btn--block" type="button" data-check ${off || app.slots.includes(null) || app.storyWatching ? 'disabled' : ''}>${app.storyWatching ? '🎬 Спочатку подивись історію' : 'Перевірити'}</button>`;
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
  if (g.mode.kind === 'exam') {
    const total = g.progress().total, marks = app.examMarks;
    $('#exam-done').textContent = marks.length;
    $('#exam-left').textContent = total - marks.length;
    $('#exam-dots').innerHTML = Array.from({ length: total }, (_, i) =>
      `<span class="${i < marks.length ? (marks[i] ? 'ok' : 'bad') : ''}${i === marks.length ? ' cur' : ''}"></span>`).join('');
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
  if (app.game.mode.kind === 'exam') app.examMarks.push(res.right);
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

  if (app.game.mode.noReveal) {             // екзамен: правильну відповідь не підказуємо
    if (!$('#choices').hidden) renderChoices(null, value);
    setTimeout(nextQuestion, FEEDBACK_MS.wrong * 0.6);
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
  } else if (typedInput()) {
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
  vid.onerror = () => { stopStoryVideo(); if (poster) { $('#story').src = poster; $('#story').hidden = false; } storyWatched(); };
  if (vid.dataset.src !== vsrc) { vid.src = `${vsrc}?v=3.81`; vid.dataset.src = vsrc; }
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
vid.addEventListener('ended', () => { $('#story-replay').hidden = false; storyWatched(); });
/** Відео-історію переглянуто до кінця (або воно не відкрилось) — можна перевіряти. */
function storyWatched() {
  if (!app.storyWatching) return;
  app.storyWatching = false;
  if (app.game && isPuzzle(app.game.mode)) renderPuzzle();
}
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
  if (app.game.mode.kind === 'story') { showVideo(q) || showStory(q); return; }
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
  const tick = () => { $('#game-timer').textContent = $('#exam-timer').textContent = fmtTime(Math.floor(app.game.elapsedMs() / 1000)); };
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
    date: `${now.toLocaleDateString('uk-UA')} ${now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
  };
  const better = isBetter(record, old);
  if (better) app.profile.records[key] = { ...record, passed: r.passed || Boolean(old?.passed) };
  else if (r.passed && old) old.passed = true;
  storage.saveRecords(app.profile.records);
  normalizeProgress();
  const idx = SEQUENCE.indexOf(stageKey(lesson, mode));

  pushResult({
    action: 'finish',
    deviceId: app.profile.deviceId,
    nickname: app.profile.nickname,
    stage: stageKey(lesson, mode),          // напр. «2_remember» — за цим полем таблиця рахує прогрес
    levelName: getLesson(lesson).name,
    gameMode: mode,
    inputMode: app.profile.inputMode === 'novice' ? 'Новачок' : 'Експерт',
    totalQuestions: r.questions, correct: r.correct, errors: r.errors, hintsCount: r.hints,
    score: r.score, time: r.time, speed: r.speed,
    status: r.passed ? 'успіх' : 'невдача',
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
  } else if (mode.kind === 'exam') {                                // Екзамен: % правильних, тривалість
    const pct = Math.round((r.correct / Math.max(1, r.questions)) * 100);
    Object.assign(v, { icon: '🎓', title: 'Екзамен складено!', main: `${pct}%`, label: 'правильних відповідей',
      stats: [stat('правильно', `✅ ${r.correct} з ${r.questions}`), stat('тривалість', `⏱ ${fmtTime(r.time)}`)] });
  } else if (mode.id === 'speed') {                                 // Перевірка: скільки правильно + швидкість
    Object.assign(v, { main: `${r.correct}/${r.questions}`, label: 'правильно', stats: [speed] });
    if (r.passed) Object.assign(v, { icon: '🎉', title: 'Перевірку пройдено!' });
    else Object.assign(v, { icon: '💪', title: 'Майже! Спробуй ще раз', record: 'Закінчились життя — 3 помилки' });
  } else {
    // Навчальні рівні: важливо, що рівень завершено, скільки тривало навчання, скільки було питань, помилок і підказок
    const titles = { training: 'Тренування успішно завершено!', associations: 'Асоціації вивчено!', stories: 'Історії пройдено!',
      remember: 'Рівень пройдено!', recall: 'Рівень пройдено!', guess: 'Картинки вгадано!' };
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
  // диплом — після марафону (від 1 бала), сертифікат — після екзамену
  dip.hidden = !((mode.id === 'records' && r.passed) || mode.kind === 'exam');
  dip.parentElement.classList.toggle('has-diploma', !dip.hidden);
  dip.title = mode.kind === 'exam' ? 'Отримати сертифікат' : 'Отримати диплом';
  dip.setAttribute('aria-label', dip.title);
  dip.onclick = () => openAward(app.sel.lesson);

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
/** Диплом за урок або сертифікат за екзамен: прев'ю у вікні + завантаження PDF. */
async function openAward(lessonId) {
  const lesson = getLesson(lessonId);
  const name = app.profile.nickname || 'Учень';
  const box = $('#diploma-preview'), btn = $('#diploma-pdf');
  const what = lesson.exam ? 'Сертифікат' : 'Диплом';
  $('#dlg-diploma .title').textContent = `🎓 ${what}`;
  box.innerHTML = `<span class="muted">Малюю ${what.toLowerCase()}…</span>`;
  btn.disabled = true;
  $('#dlg-diploma').showModal();
  try {
    const { lessonDiploma, examCertificate, parseRecordDate, downloadPdf } = await import('./diploma.js?v=3.81');
    const code = await shareCode(app.profile.deviceId);
    const recKey = recordKey(lesson.id, lesson.exam ? 'exam' : 'records');
    const rec = app.profile.records[recKey] || {};
    const date = parseRecordDate(rec.date) || new Date();
    const canvas = lesson.exam ? await examCertificate({ name, rec, date, code })
      : await lessonDiploma({ name, lesson, date, code });
    box.replaceChildren(el('img', { src: canvas.toDataURL('image/jpeg', 0.85), alt: `${what}: ${name}` }));
    btn.disabled = false;
    btn.onclick = () => downloadPdf(canvas, `${what} — ${name}.pdf`);
  } catch {
    box.innerHTML = `<span class="muted">Не вдалося намалювати. Спробуй ще раз.</span>`;
  }
}

$('#dlg-result').addEventListener('cancel', e => e.preventDefault()); // Esc не закриває без вибору

// ---------- Статистика ----------
function openStats() {
  $('#stats-id').textContent = app.profile.deviceId;
  $('#stats-ava').innerHTML = avatarImg();
  $('#stats-name').textContent = app.profile.nickname || 'Учень';
  $('#stats-body').replaceChildren(...LESSONS.map(l => {
    const box = el('section', { className: 'stats__lesson' });
    const rows = modesFor(l.id).map(m => {
      const r = app.profile.records[recordKey(l.id, m.id)];
      const name = `${m.name}${isPassed(l.id, m.id) ? ' <span class="ok">✓</span>' : ''}`;
      if (!r) return `<div class="stats__row"><span>${name}</span><span class="stats__empty" style="grid-column:span 4">ще не грали</span></div>`;
      return `<div class="stats__row" title="${String(r.date || '').replace(/"/g, '')}"><span>${name}</span><b>${Number(r.score) || 0}</b>
        <span class="ok">${Number(r.correct) || 0}</span><span class="bad">${Number(r.errors) || 0}</span><span>${fmtTime(Number(r.time) || 0)}</span></div>`;
    }).join('');
    const award = l.exam ? (app.profile.records[recordKey(l.id, 'exam')] ? 'Сертифікат' : '')
      : modesFor(l.id).every(m => isPassed(l.id, m.id)) ? 'Диплом' : '';
    box.innerHTML = `<h3 class="stats__title"><span>${l.name}</span>${award
      ? `<button class="btn btn--small btn--diploma" type="button" data-award="${l.id}">⬇ ${award}</button>` : ''}</h3><div class="stats__row head"><span>Рівень</span><span>Бали</span><span>Вірно</span><span>Помилки</span><span>Час</span></div>${rows}`;
    return box;
  }));
  $('#dlg-stats').showModal();
}
$('#stats-body').addEventListener('click', e => {
  const b = e.target.closest('[data-award]');
  if (b) openAward(Number(b.dataset.award));
});

// ---------- Карта уроків і локації ----------
// Координати у відсотках сцени: карта 3:4 (локації зліва направо), локація 3:5 (рівні знизу вгору).
// Точки підібрано під картинку фону: бухта з маяком, острів метеликів, лука біля равлика, лука під замком
// Точки на карті (зигзаг знизу вгору): пляж → нижня галявина → луг на острові квітів → луг під замком → екзамен
const levelPoints = n => Array.from({ length: n }, (_, i) => [
  50 + 30 * Math.sin((i * Math.PI) / 2),            // змійка: центр → право → центр → ліво
  n === 1 ? 50 : 85 - (i * 75) / (n - 1),            // знизу вгору
]);

const hasArt = name => ASSETS.art.includes(name);
const artImg = (name, alt = '') => `<img src="${ASSETS.artUrl(name)}?v=3.81" alt="${alt}" loading="lazy" decoding="async">`;
const stageIdx = (lesson, mode) => SEQUENCE.indexOf(stageKey(lesson, mode));
const progressIdx = () => Math.max(0, SEQUENCE.indexOf(app.profile.progress));

function updateUser() {
  const name = app.profile.nickname || 'Учень';
  document.querySelectorAll('[data-user-name]').forEach(n => { n.textContent = name; });
  document.querySelectorAll('[data-user-avatar]').forEach(n => { n.innerHTML = avatarImg(); });
  document.querySelectorAll('[data-sync]').forEach(n => { if (!n.textContent) n.textContent = '💾 Збережено на пристрої'; });
}

function openMap() {
  normalizeProgress();
  updateUser();
  renderMap();
  show('screen-map');
}

/** «12 хв», «1 год 5 хв», «40 с». */
const fmtDur = secs => {
  secs = Math.round(secs || 0);
  if (secs < 60) return `${secs} с`;
  const m = Math.round(secs / 60), h = Math.floor(m / 60);
  return h ? `${h} год${m % 60 ? ` ${m % 60} хв` : ''}` : `${m} хв`;
};
/** Скільки часу пішло на урок: сума часу найкращих спроб усіх його рівнів. */
const lessonTime = l => modesFor(l.id).reduce((t, m) => t + (Number(app.profile.records[recordKey(l.id, m.id)]?.time) || 0), 0);

function renderMap() {
  normalizeProgress();
  const cur = parseStage(app.profile.progress).lesson;
  if (!app.map) app.map = createMapView($('#map-stage'), { image: `${ASSETS.artUrl('map-bg')}?v=3.81` });
  const lessonDone = l => modesFor(l.id).every(m => isPassed(l.id, m.id));
  const done = LESSONS.filter(lessonDone).length;

  const markers = LESSONS.map(l => {
    const modes = modesFor(l.id);
    const passed = modes.filter(m => isPassed(l.id, m.id)).length;
    const locked = stageIdx(l.id, modes[0].id) > progressIdx();
    const state = l.id === cur && !lessonDone(l) ? 'current' : lessonDone(l) ? 'done' : locked ? 'locked' : 'open';
    // усередині краплі — картинка уроку; стан — маленька позначка на краплі (аватарка / ✓ / 🔒)
    const inner = state === 'current' ? avatarImg() : hasArt(`loc${l.id}`) ? artImg(`loc${l.id}`, '') : tileHTML(l.place.tile, 1);
    const badge = '';   // стан видно за кольором краплі: зелена — пройдено, сіра — закрито, жовта — поточна
    const t = lessonTime(l);
    const pic = hasArt(`loc${l.id}`) ? artImg(`loc${l.id}`, '') : '';
    const sub = l.name;   // повна назва: «Урок 1: Множення на 0, 1, 2»
    const info = locked ? (l.exam ? '🔒 Відкриється, коли пройдеш усі уроки' : `🔒 Спочатку пройди «${getLesson(l.id - 1).place.name}»`)
      : `⭐ ${passed}/${modes.length}${t ? ` · 🕒 ${fmtDur(t)}` : ''}`;
    const bubble = `<div class="gbubble__pic">${pic}</div>
      <div class="gbubble__body"><b>${l.place.name}</b><small>${sub}</small><small>${info}</small>
      ${locked ? '' : `<button type="button" class="btn btn--primary btn--small" data-open="${l.id}">${state === 'done' ? 'Повторити' : 'Вперед'} →</button>`}</div>`;
    return { id: l.id, x: l.place.map[0], y: l.place.map[1], state, inner, badge, title: l.place.name, bubble };
  });

  const segments = LESSONS.slice(0, -1).map((l, i) => {
    const next = LESSONS[i + 1];
    const ok = lessonDone(l);
    return { points: [l.place.map, ...(l.place.route || []), next.place.map], done: ok, label: ok ? `🕒 ${fmtDur(lessonTime(l))}` : null };
  });
  const totalSecs = LESSONS.reduce((t, l) => t + lessonTime(l), 0);
  const totalHtml = totalSecs ? `🕒 У дорозі <b>${fmtDur(totalSecs)}</b> · 🚩 ${done} з ${LESSONS.length}` : '';

  app.map.setData({ markers, segments, total: totalHtml }, openPlace);
  $('#map-note').textContent = done === LESSONS.length ? '🏆 Курс пройдено, екзамен складено!'
    : done === COURSE_LESSONS ? '🎓 Усі уроки пройдено — час для екзамену!' : 'Натисни на мітку на карті, щоб відкрити урок';
}

/** Перехід з бульбашки на карті: урок → екран локації, екзамен → одразу гра. */
function openPlace(id) {
  id = Number(id);
  app.map?.closeBubble();
  if (getLesson(id).exam) { app.returnTo = 'map'; startGame(id, 'exam'); return; }
  openLocation(id);
}

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
  $('#place-sub').textContent = `Урок ${l.id} · ×${l.factors.join(', ')}`;
  $('#place-stars').textContent = `⭐ ${passed}/${modes.length}`;
  const bg = hasArt(`loc${l.id}-bg`) ? `${ASSETS.artUrl(`loc${l.id}-bg`)}?v=3.81` : `${ASSETS.artUrl('map-bg')}?v=3.81`;
  if (!app.placeMap) app.placeMap = createMapView($('#place-stage'), { image: bg });
  app.placeMap.setImage(bg);
  const pts = l.place.levels?.length >= modes.length ? l.place.levels : levelPoints(modes.length);
  const timeOf = m => Number(app.profile.records[recordKey(l.id, m.id)]?.time) || 0;

  const markers = modes.map((m, i) => {
    const idx = stageIdx(l.id, m.id);
    const done = isPassed(l.id, m.id);
    const state = idx === pIdx && !done ? 'current' : done ? 'done' : idx > pIdx ? 'locked' : 'open';
    const inner = state === 'current' ? avatarImg() : hasArt(`lvl-${m.id}`) ? artImg(`lvl-${m.id}`, '') : `<span class="node__emoji">${MODE_ICONS[m.id]}</span>`;
    const badge = '';   // стан видно за кольором краплі: зелена — пройдено, сіра — закрито, жовта — поточна
    const rec = app.profile.records[recordKey(l.id, m.id)];
    const pic = hasArt(`lvl-${m.id}`) ? artImg(`lvl-${m.id}`, '') : `<span class="node__emoji">${MODE_ICONS[m.id]}</span>`;
    const info = state === 'locked' ? '🔒 Відкриється, коли пройдеш попередній рівень'
      : rec ? `${done ? '✓ пройдено' : 'ще не пройдено'}${timeOf(m) ? ` · 🕒 ${fmtDur(timeOf(m))}` : ''}` : 'ще не грали';
    const bubble = `<div class="gbubble__pic">${pic}</div>
      <div class="gbubble__body"><b>${m.name}</b><small>${l.name}</small><small>${info}</small>
      ${state === 'locked' ? '' : `<button type="button" class="btn btn--primary btn--small" data-open="${m.id}">${done ? 'Ще раз' : 'Грати'} →</button>`}</div>`;
    return { id: m.id, x: pts[i][0], y: pts[i][1], state, inner, badge, title: m.name, bubble };
  });
  const segments = modes.slice(0, -1).map((m, i) => {
    const ok = isPassed(l.id, m.id);
    return { points: [pts[i], pts[i + 1]], done: ok, label: ok && timeOf(m) ? `🕒 ${fmtDur(timeOf(m))}` : null };
  });
  const total = lessonTime(l);
  app.placeMap.setData({ markers, segments, total: total ? `🕒 У дорозі <b>${fmtDur(total)}</b> · ⭐ ${passed} з ${modes.length}` : '' }, startLevel);
}

/** Запуск рівня з бульбашки на екрані локації. */
function startLevel(modeId) {
  app.placeMap?.closeBubble();
  app.returnTo = 'location';
  startGame(app.place, modeId);
}

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

// ---------- Аватарка і фото ----------
// Аватарки — персонажі гри в повний зріст (assets/avatars/0…13.webp); 13 — зелений дракончик, він за замовчуванням
const HERO_NAMES = ['Дракончик', 'Дракоша з бантиком', 'Динозаврик', 'Мураха', 'Рибка', 'Сонечко', 'Маяк', 'Равлик',
  'Порося', 'Глобус', 'Гусениця', 'Телевізор', 'Дельфін', 'Зелений дракончик'];
const DEFAULT_AVATAR = 13;
const HEROES = [DEFAULT_AVATAR, ...HERO_NAMES.map((_, i) => i).filter(i => i !== DEFAULT_AVATAR)]; // у виборі — першим
const heroUrl = n => `assets/avatars/${n}.webp?v=3.81`;
const usesPhoto = () => app.profile.avatar === 'photo' && app.profile.photo;
function avatarImg() {
  if (usesPhoto()) return `<img class="avatar-img" src="${app.profile.photo}" alt="">`;
  const n = Number(app.profile.avatar);
  return `<img class="avatar-img avatar-img--hero" src="${heroUrl(Number.isInteger(n) && n >= 0 && n < HERO_NAMES.length ? n : DEFAULT_AVATAR)}" alt="">`;
}
/** Надіслати аватарку в таблицю (номер героя або «photo» + саме фото). */
function pushProfile() {
  pushResult({ action: 'profile', deviceId: app.profile.deviceId, avatar: app.profile.avatar, photo: app.profile.photo || '' });
}
function setAvatar(avatar, photo = app.profile.photo) {
  app.profile.avatar = String(avatar);
  app.profile.photo = photo || '';
  storage.saveAvatar(app.profile);
  pushProfile();
  updateUser();
  if (!$('#screen-map').hidden) renderMap();
}

// Вибір у вікні — чернетка; застосовується лише кнопкою OK (закрити вікно без OK = нічого не міняти)
const pick = { avatar: null, photo: '' };
function openAvatarDialog(keep = false) {
  if (!keep) { pick.avatar = app.profile.avatar; pick.photo = app.profile.photo; }
  const cur = pick.avatar;
  const tiles = [];
  if (pick.photo) {
    tiles.push(`<button type="button" class="avatar-tile${cur === 'photo' ? ' is-on' : ''}" data-avatar="photo" aria-label="Моє фото">
      <img src="${pick.photo}" alt=""><span class="avatar-tile__edit" data-edit-photo title="Редагувати фото">✏️</span></button>`);
  }
  for (const n of HEROES) {
    tiles.push(`<button type="button" class="avatar-tile${cur === String(n) ? ' is-on' : ''}" data-avatar="${n}" aria-label="${HERO_NAMES[n]}">
      <img class="avatar-img--hero" src="${heroUrl(n)}" alt=""></button>`);
  }
  $('#avatar-grid').innerHTML = tiles.join('');
  if (!$('#dlg-avatar').open) $('#dlg-avatar').showModal();
}
document.querySelectorAll('[data-user-avatar]').forEach(b => b.addEventListener('click', () => openAvatarDialog()));
$('#avatar-grid').addEventListener('click', e => {
  if (e.target.closest('[data-edit-photo]')) { openEditor(pick.photo); return; }
  const t = e.target.closest('[data-avatar]');
  if (!t) return;
  if (t.dataset.avatar === 'photo' && pick.avatar === 'photo') { openEditor(pick.photo); return; } // клік на вибране фото — редактор
  pick.avatar = t.dataset.avatar;
  $('#avatar-grid').querySelectorAll('.avatar-tile').forEach(x => x.classList.toggle('is-on', x === t));
});
$('#avatar-ok').addEventListener('click', () => {
  if (pick.avatar !== app.profile.avatar || pick.photo !== app.profile.photo) setAvatar(pick.avatar, pick.photo);
  $('#dlg-avatar').close();
});

// Файл з пристрою або камера телефону
const readFile = file => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result); r.onerror = fail;
  r.readAsDataURL(file);
});
for (const id of ['#photo-file', '#photo-capture']) {
  $(id).addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openEditor(await readFile(f));
  });
}

// Камера: на телефоні — системна камера (input capture), на комп'ютері — вебкамера в браузері
let camStream = null;
function stopCamera() { camStream?.getTracks().forEach(t => t.stop()); camStream = null; }
$('#btn-camera').addEventListener('click', async () => {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch || !navigator.mediaDevices?.getUserMedia) { $('#photo-capture').click(); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 720 } });
  } catch { toast('Не вдалося увімкнути камеру — завантаж фото з пристрою'); return; }
  $('#cam-video').srcObject = camStream;
  $('#photo-title').textContent = '📷 Камера';
  $('#cam').hidden = false; $('#editor').hidden = true;
  $('#dlg-photo').showModal();
});
$('#cam-shot').addEventListener('click', () => {
  const v = $('#cam-video'), c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const x = c.getContext('2d');
  x.translate(c.width, 0); x.scale(-1, 1);          // як у дзеркалі — так, як дитина бачила себе
  x.drawImage(v, 0, 0);
  stopCamera();
  openEditor(c.toDataURL('image/jpeg', 0.92));
});
$('#dlg-photo').addEventListener('close', stopCamera);

// Редактор: посунути, збільшити, повернути; результат — квадрат 192×192 (показується в колі)
const ed = { img: null, zoom: 1, rot: 0, ox: 0, oy: 0 };
const edCanvas = $('#editor-canvas');
function drawEditor(ctx = edCanvas.getContext('2d'), size = edCanvas.width, overlay = true) {
  const k = size / edCanvas.width;
  ctx.save();
  ctx.fillStyle = '#f2efe9'; ctx.fillRect(0, 0, size, size);
  if (ed.img) {
    const turned = ed.rot % 180 !== 0;
    const iw = turned ? ed.img.height : ed.img.width, ih = turned ? ed.img.width : ed.img.height;
    const base = Math.max(edCanvas.width / iw, edCanvas.width / ih) * 0.92;  // коло — 92% квадрата
    ctx.translate(size / 2 + ed.ox * k, size / 2 + ed.oy * k);
    ctx.rotate(ed.rot * Math.PI / 180);
    const sc = base * ed.zoom * k;
    ctx.drawImage(ed.img, -ed.img.width * sc / 2, -ed.img.height * sc / 2, ed.img.width * sc, ed.img.height * sc);
  }
  ctx.restore();
  if (overlay) {
    ctx.save();
    ctx.fillStyle = 'rgba(31,36,48,.55)';
    ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
function openEditor(src) {
  const img = new Image();
  img.onload = () => {
    Object.assign(ed, { img, zoom: 1, rot: 0, ox: 0, oy: 0 });
    $('#editor-zoom').value = 1;
    $('#photo-title').textContent = '✏️ Моє фото';
    $('#cam').hidden = true; $('#editor').hidden = false;
    if (!$('#dlg-photo').open) $('#dlg-photo').showModal();
    drawEditor();
  };
  img.onerror = () => toast('Не вдалося відкрити це фото');
  img.src = src;
}
$('#editor-zoom').addEventListener('input', e => { ed.zoom = Number(e.target.value); drawEditor(); });
$('#editor-rotate').addEventListener('click', () => { ed.rot = (ed.rot + 90) % 360; drawEditor(); });
{
  let drag = null;
  edCanvas.addEventListener('pointerdown', e => { edCanvas.setPointerCapture(e.pointerId); drag = [e.clientX, e.clientY]; });
  edCanvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const k = edCanvas.width / edCanvas.getBoundingClientRect().width;
    ed.ox += (e.clientX - drag[0]) * k; ed.oy += (e.clientY - drag[1]) * k;
    drag = [e.clientX, e.clientY];
    drawEditor();
  });
  edCanvas.addEventListener('pointerup', () => { drag = null; });
  edCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    ed.zoom = Math.min(4, Math.max(1, ed.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    $('#editor-zoom').value = ed.zoom; drawEditor();
  }, { passive: false });
}
$('#editor-save').addEventListener('click', () => {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d');
  // зберігаємо лише коло (кут — фон), щоб фото в таблиці було маленьким (≈10 КБ)
  ctx.translate(-192 * 0.04 / 0.92, -192 * 0.04 / 0.92);
  ctx.scale(1 / 0.92, 1 / 0.92);
  drawEditor(ctx, 192, false);
  let q = 0.85, data = c.toDataURL('image/jpeg', q);
  while (data.length > 40000 && q > 0.4) { q -= 0.1; data = c.toDataURL('image/jpeg', q); } // клітинка таблиці — до 50 000 символів
  pick.avatar = 'photo'; pick.photo = data;          // у вікні вибору; збережеться після OK
  $('#dlg-photo').close();
  if ($('#dlg-avatar').open) openAvatarDialog(true);
  else setAvatar('photo', data);
});

// ---------- Старт ----------
function boot() {
  if (!app.profile.deviceId) { show('screen-login'); return; }
  openMap();        // одразу показуємо карту з локальних даних…
  sync();           // …а хмару підтягуємо фоном
  // Підвантажити спрайт картинок, поки дитина обирає урок
  (window.requestIdleCallback || setTimeout)(() => { new Image().src = 'assets/tiles.webp?v=3.81'; });
}
boot();
