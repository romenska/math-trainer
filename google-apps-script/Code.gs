/**
 * Тренажер множення — сервер на Google Apps Script.
 *
 * ЄДИНЕ ДЖЕРЕЛО ПРАВДИ — лист «Статистика»: один рядок на кожну зіграну гру.
 * Пройдені рівні, рекорди й поточний рівень учня НЕ зберігаються окремо — вони щоразу
 * обчислюються з цього журналу. Тому, щоб відкотити прогрес (наприклад, після тестів під
 * обліковкою дитини), досить видалити зайві рядки в «Статистиці».
 *
 * Лист «Учні» — довідник (пароль, ім'я, режим вводу, дата реєстрації, аватар, фото) плюс колонки
 * для зручного перегляду, які скрипт сам перераховує з «Статистики»:
 *   «Остання гра», «Ігор зіграно», «Пройдено рівнів», «Пройдено до», «Наступний рівень», «Екзамен».
 * Їх не треба редагувати руками. Після видалення рядків у «Статистиці» оновіть їх:
 * меню «Тренажер» → «Оновити прогрес учнів» (або вони оновляться самі при наступному вході учня).
 *
 * Після вставки коду: Розгорнути → Керування розгортаннями → ✏️ → Версія: «Нова версія» → Розгорнути.
 */

var SHEET_STUDENTS = 'Учні';
var SHEET_STATS = 'Статистика';

var STATS_HEADERS = ['Дата', 'Device ID', "Ім'я", 'Рівень', 'Режим гри', 'Режим вводу', 'Всього питань',
  'Правильних', 'Помилок', 'Підказок', 'Бали', 'Час (сек)', 'Швидкість (пр/с)', 'Статус', 'Етап'];
var S = { date: 0, id: 1, name: 2, level: 3, mode: 4, input: 5, total: 6, correct: 7, errors: 8, hints: 9,
  score: 10, time: 11, speed: 12, status: 13, stage: 14 }; // індекси колонок «Статистики» (з 0)

var STUDENT_HEADERS = ['Device ID', "Ім'я", 'Режим вводу', 'Зареєстровано', 'Аватар', 'Фото', 'Остання гра', 'Ігор зіграно',
  'Пройдено рівнів', 'Пройдено до', 'Наступний рівень', 'Екзамен'];
var STORED = 6; // перші 6 колонок «Учнів» — дані; решта розраховується
// Аватар: номер аватарки 0–13 (13 — зелений дракончик, за замовчуванням) або «photo» — тоді показується фото з колонки «Фото» (data:image/jpeg;base64,…)

// Порядок рівнів — як у тренажері (js/config.js)
var LESSON_NAMES = { 1: 'Драконова бухта', 2: 'Острів метеликів', 3: 'Равликове містечко', 4: 'Королівство Глобуса', 5: 'Екзамен' };
var MODES = ['guess', 'stories', 'associations', 'remember', 'recall', 'training', 'speed', 'records'];
var MODE_NAMES = { guess: 'Вгадай число', stories: 'Історії', associations: 'Асоціації', remember: 'Запам’ятай',
  recall: 'Пригадай', training: 'Тренування', speed: 'Перевірка', records: 'Марафон', exam: 'Екзамен' };
var SEQUENCE = [];
for (var l = 1; l <= 4; l++) for (var m = 0; m < MODES.length; m++) SEQUENCE.push(l + '_' + MODES[m]);
SEQUENCE.push('5_exam');

// ===================== Вхідні запити =====================

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var data = JSON.parse(e.postData.contents);
    if (!data.deviceId) return json({ status: 'error', message: 'no deviceId' });
    if (data.action === 'finish') appendStats(data);
    var row = upsertStudent(data);
    if (data.action === 'finish') refreshStudentRow(row, data.deviceId);
    return json({ status: 'success' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  // Перегляд статистики за кодом (QR на дипломі): лише читання, пароль не повертаємо
  if (p.action === 'view') {
    var st = findStudentByCode(String(p.code || '').toLowerCase());
    if (!st) return json({ status: 'not_found' });
    var rv = recordsFromLog(st.id);
    return json({ status: 'success', nickname: st.name, currentCombinedLevel: nextStage(rv), records: rv });
  }
  if (!p.deviceId) return json({ status: 'error', message: 'no deviceId' });

  var sh = studentsSheet();
  var row = findRow(sh, p.deviceId);
  var records = recordsFromLog(p.deviceId);
  if (!row && !Object.keys(records).length) return json({ status: 'not_found', records: {} });
  if (!row) row = upsertStudent({ deviceId: p.deviceId, nickname: lastNameInLog(p.deviceId) });
  var r = sh.getRange(row, 1, 1, STORED).getValues()[0];
  refreshStudentRow(row, p.deviceId, records);
  return json({
    status: 'success',
    nickname: r[1] || 'Учень',
    inputMode: r[2] === 'Експерт' ? 'expert' : 'novice',
    avatar: r[4] === '' ? '' : String(r[4]),
    photo: String(r[5] || ''),
    currentCombinedLevel: nextStage(records),
    records: records
  });
}

/** Меню в таблиці. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Тренажер')
    .addItem('Оновити прогрес учнів', 'refreshAllStudents')
    .addToUi();
}

// ===================== «Статистика» — журнал ігор =====================

function statsSheet() {
  var sh = getSheet(SHEET_STATS, STATS_HEADERS);
  // старий лист без колонки «Етап» — дописати заголовок
  if (sh.getRange(1, S.stage + 1).getValue() !== 'Етап') {
    sh.getRange(1, 1, 1, STATS_HEADERS.length).setValues([STATS_HEADERS]).setFontWeight('bold');
  }
  return sh;
}

function appendStats(d) {
  statsSheet().appendRow([
    new Date(), d.deviceId, d.nickname || '', d.levelName || '', d.gameMode || '', d.inputMode || '',
    num(d.totalQuestions), num(d.correct), num(d.errors), num(d.hintsCount),
    num(d.score), num(d.time), num(d.speed), d.status || '', d.stage || ''
  ]);
}

/** Етап гри з рядка журналу: колонка «Етап», а для старих рядків — з назви уроку і режиму. */
function stageOf(row) {
  var stage = String(row[S.stage] || '');
  if (SEQUENCE.indexOf(stage) !== -1) return stage;
  var mode = String(row[S.mode] || '');
  if (mode === 'exam') return '5_exam';
  if (mode === 'numbers') mode = 'guess';           // старі «Вгадай цифру/число» → «Вгадай число» уроку 1
  if (MODES.indexOf(mode) === -1) return '';
  var lesson = (String(row[S.level]).match(/Урок\s*(\d)/) || [])[1] || '1';
  return lesson + '_' + mode;
}

/** Усі рядки журналу (з колонкою «Етап», навіть якщо її ще немає). */
function logRows() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), STATS_HEADERS.length)).getValues();
}

/** Рекорди учня, зібрані з журналу: для кожного рівня — найкращий результат і чи пройдено хоч раз. */
function recordsFromLog(deviceId, rows) {
  rows = rows || logRows();
  var out = {};
  var tz = Session.getScriptTimeZone();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[S.id]) !== String(deviceId)) continue;
    var stage = stageOf(row);
    if (!stage) continue;
    var parts = stage.split('_');
    var key = 'L' + parts[0] + '_' + parts[1];
    var rec = {
      score: num(row[S.score]), totalQuestions: num(row[S.total]), correct: num(row[S.correct]),
      errors: num(row[S.errors]), hintsCount: num(row[S.hints]), time: num(row[S.time]), speed: num(row[S.speed]),
      date: row[S.date] ? Utilities.formatDate(new Date(row[S.date]), tz, 'dd.MM.yyyy HH:mm:ss') : '',
      passed: String(row[S.status]) === 'успіх'
    };
    var old = out[key];
    var best = isBetter(rec, old) ? rec : old;
    best.passed = rec.passed || Boolean(old && old.passed);
    out[key] = best;
  }
  return out;
}

function lastNameInLog(deviceId) {
  var rows = logRows(), name = '';
  for (var i = 0; i < rows.length; i++) if (String(rows[i][S.id]) === String(deviceId) && rows[i][S.name]) name = rows[i][S.name];
  return name;
}

// ===================== Прогрес (обчислюється) =====================

function passedStages(records) {
  return SEQUENCE.filter(function (s) { var p = s.split('_'); var r = records['L' + p[0] + '_' + p[1]]; return r && r.passed; });
}

/** Наступний рівень: після останнього пройденого (так само рахує тренажер). */
function nextStage(records) {
  var idx = 0;
  for (var i = 0; i < SEQUENCE.length; i++) {
    var p = SEQUENCE[i].split('_'), r = records['L' + p[0] + '_' + p[1]];
    if (r && r.passed) idx = Math.min(i + 1, SEQUENCE.length - 1);
  }
  return SEQUENCE[idx];
}

function stageName(stage) {
  if (!stage) return '—';
  var p = stage.split('_');
  return p[0] === '5' ? 'Екзамен' : 'Урок ' + p[0] + ' · ' + LESSON_NAMES[p[0]] + ' · ' + MODE_NAMES[p[1]];
}

/** Перерахувати колонки перегляду для одного учня. */
function refreshStudentRow(row, deviceId, records, rows) {
  if (!row) return;
  rows = rows || logRows();
  records = records || recordsFromLog(deviceId, rows);
  var passed = passedStages(records);
  var last = passed.length ? passed[passed.length - 1] : '';
  var exam = records['L5_exam'];
  var count = 0, lastGame = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][S.id]) !== String(deviceId)) continue;
    count++;
    if (rows[i][S.date] && (!lastGame || rows[i][S.date] > lastGame)) lastGame = rows[i][S.date];
  }
  studentsSheet().getRange(row, STORED + 1, 1, STUDENT_HEADERS.length - STORED).setValues([[
    lastGame,
    count,
    passed.length + ' / ' + SEQUENCE.length,
    stageName(last),
    exam && exam.passed ? 'курс завершено' : stageName(nextStage(records)),
    exam && exam.totalQuestions ? Math.round(exam.correct / exam.totalQuestions * 100) + '%' : ''
  ]]);
}

/** Меню «Тренажер» → «Оновити прогрес учнів». */
function refreshAllStudents() {
  var sh = studentsSheet();
  if (sh.getLastRow() < 2) return;
  var rows = logRows();
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0]) refreshStudentRow(i + 2, String(ids[i][0]), null, rows);
}

// ===================== «Учні» — довідник =====================

/** Лист «Учні» у новому форматі. Старий формат (з колонками «Прогрес», «Рекорди (JSON)») переводиться автоматично. */
function studentsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_STUDENTS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_STUDENTS);
    sh.appendRow(STUDENT_HEADERS);
    styleStudents(sh);
    return sh;
  }
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (head.slice(0, STUDENT_HEADERS.length).join('|') === STUDENT_HEADERS.join('|')) return sh;

  // міграція: беремо лише довідкові дані за назвами колонок, решту буде перераховано з журналу
  var col = function (name) { return head.indexOf(name); };
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues() : [];
  var data = rows.filter(function (r) { return r[col('Device ID')]; }).map(function (r) {
    var out = [r[col('Device ID')], r[col("Ім'я")] || 'Учень', col('Режим вводу') >= 0 ? r[col('Режим вводу')] : 'Новачок',
      col('Зареєстровано') >= 0 ? r[col('Зареєстровано')] : '',
      col('Аватар') >= 0 ? r[col('Аватар')] : '', col('Фото') >= 0 ? r[col('Фото')] : ''];
    while (out.length < STUDENT_HEADERS.length) out.push('');
    return out;
  });
  sh.clear();
  sh.getRange(1, 1, 1, STUDENT_HEADERS.length).setValues([STUDENT_HEADERS]);
  if (data.length) sh.getRange(2, 1, data.length, STUDENT_HEADERS.length).setValues(data);
  styleStudents(sh);
  var log = logRows();
  for (var i = 0; i < data.length; i++) refreshStudentRow(i + 2, String(data[i][0]), null, log);
  return sh;
}

function styleStudents(sh) {
  sh.getRange(1, 1, 1, STUDENT_HEADERS.length).setFontWeight('bold');
  sh.getRange(1, STORED + 1, 1, STUDENT_HEADERS.length - STORED).setBackground('#eef3fb')
    .setNote('Розраховується автоматично з листа «Статистика». Не редагуйте вручну — після змін у «Статистиці» натисніть меню «Тренажер» → «Оновити прогрес учнів».');
  sh.setFrozenRows(1);
}

/** Додати учня або оновити ім'я/режим вводу. Повертає номер рядка. */
function upsertStudent(d) {
  var sh = studentsSheet();
  var row = findRow(sh, d.deviceId);
  var photo = typeof d.photo === 'string' && d.photo.length < 49000 ? d.photo : undefined; // клітинка — до 50 000 символів
  if (!row) {
    sh.appendRow([d.deviceId, d.nickname || 'Учень', d.inputMode || 'Новачок', new Date(),
      d.avatar === undefined ? 13 : d.avatar, photo || '']);
    return sh.getLastRow();
  }
  var r = sh.getRange(row, 1, 1, STORED).getValues()[0];
  sh.getRange(row, 1, 1, STORED).setValues([[d.deviceId, d.nickname || r[1] || 'Учень', d.inputMode || r[2], r[3] || new Date(),
    d.avatar === undefined ? r[4] : d.avatar, photo === undefined ? r[5] : photo]]);
  return row;
}

/** Номер рядка учня (швидкий пошук TextFinder) або 0. */
function findRow(sh, deviceId) {
  if (sh.getLastRow() < 2) return 0;
  var cell = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
    .createTextFinder(String(deviceId)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

/** Код перегляду = перші 16 hex-символів SHA-256('mt:' + ID) — так само рахує тренажер (js/cloud.js). */
function shareCode(deviceId) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'mt:' + deviceId, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < 8; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}

function findStudentByCode(code) {
  if (!/^[0-9a-f]{16}$/.test(code)) return null;
  var sh = studentsSheet();
  if (sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] && shareCode(String(rows[i][0])) === code) return { id: String(rows[i][0]), name: rows[i][1] || 'Учень' };
  }
  return null;
}

// ===================== Допоміжне =====================

function getSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function isBetter(rec, old) {
  if (!old) return true;
  if (num(rec.score) !== num(old.score)) return num(rec.score) > num(old.score);
  return num(rec.time) < num(old.time);
}

function num(v) { return Number(v) || 0; }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
