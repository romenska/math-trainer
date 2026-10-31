/**
 * Тренажер множення — сервер на Google Apps Script.
 *
 * Два листи:
 *   «Учні»       — один рядок на учня: ім'я, прогрес, остання активність, рекорди.
 *                  Звідси тренажер швидко відновлює профіль за ID.
 *   «Статистика» — журнал: один рядок на кожну зіграну гру (як і раніше).
 *
 * Після вставки коду: Розгорнути → Керування розгортаннями → ✏️ → Версія: «Нова версія» → Розгорнути.
 * Так адреса (URL) лишиться тією самою, і змінювати її в тренажері не треба.
 */

var SHEET_STUDENTS = 'Учні';
var SHEET_STATS = 'Статистика';

var STUDENT_HEADERS = ['Device ID', "Ім'я", 'Режим вводу', 'Прогрес', 'Зареєстровано',
  'Остання активність', 'Ігор зіграно', 'Сума найкращих балів', 'Рекорди (JSON)'];
var STATS_HEADERS = ['Дата', 'Device ID', "Ім'я", 'Рівень', 'Режим гри', 'Режим вводу', 'Всього питань',
  'Правильних', 'Помилок', 'Підказок', 'Бали', 'Час (сек)', 'Швидкість (пр/с)', 'Статус'];

// Колонки листа «Учні» (номери з 1)
var C = { id: 1, name: 2, input: 3, progress: 4, created: 5, seen: 6, games: 7, total: 8, records: 9 };

var MODES = ['associations', 'training', 'speed', 'records'];
var SEQUENCE = [];
for (var l = 1; l <= 4; l++) for (var m = 0; m < MODES.length; m++) SEQUENCE.push(l + '_' + MODES[m]);

// ===================== Вхідні запити =====================

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // два учні одночасно не створять дублікати рядків
    var data = JSON.parse(e.postData.contents);
    if (!data.deviceId) return json({ status: 'error', message: 'no deviceId' });

    if (data.action === 'finish') appendStats(data);
    upsertStudent(data, data.action === 'finish');

    return json({ status: 'success' });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.deviceId) return json({ status: 'error', message: 'no deviceId' });

  var student = findStudent(p.deviceId);
  if (!student) student = migrateFromStats(p.deviceId); // учні зі старої версії
  if (!student) return json({ status: 'not_found', records: {} });

  return json({
    status: 'success',
    nickname: student.name,
    inputMode: student.input === 'Експерт' ? 'expert' : 'novice',
    currentCombinedLevel: student.progress,
    records: student.records
  });
}

// ===================== Лист «Статистика» =====================

function appendStats(d) {
  var sh = getSheet(SHEET_STATS, STATS_HEADERS);
  sh.appendRow([
    new Date(), d.deviceId, d.nickname || '', d.levelName || '', d.gameMode || '', d.inputMode || '',
    num(d.totalQuestions), num(d.correct), num(d.errors), num(d.hintsCount),
    num(d.score), num(d.time), num(d.speed), d.status || ''
  ]);
}

// ===================== Лист «Учні» =====================

function upsertStudent(d, countGame) {
  var sh = getSheet(SHEET_STUDENTS, STUDENT_HEADERS);
  var row = findRow(sh, d.deviceId);
  var now = new Date();

  if (!row) {
    var records = mergeRecords({}, d.records);
    sh.appendRow([d.deviceId, d.nickname || 'Учень', d.inputMode || 'Новачок', d.currentCombinedLevel || SEQUENCE[0],
      now, now, countGame ? 1 : 0, totalScore(records), JSON.stringify(records)]);
    return;
  }

  var r = sh.getRange(row, 1, 1, STUDENT_HEADERS.length).getValues()[0];
  var records2 = mergeRecords(parseJSON(r[C.records - 1]), d.records);
  sh.getRange(row, 1, 1, STUDENT_HEADERS.length).setValues([[
    d.deviceId,
    d.nickname || r[C.name - 1] || 'Учень',
    d.inputMode || r[C.input - 1],
    furthest(r[C.progress - 1], d.currentCombinedLevel),
    r[C.created - 1] || now,
    now,
    num(r[C.games - 1]) + (countGame ? 1 : 0),
    totalScore(records2),
    JSON.stringify(records2)
  ]]);
}

function findStudent(deviceId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STUDENTS);
  if (!sh) return null;
  var row = findRow(sh, deviceId);
  if (!row) return null;
  var r = sh.getRange(row, 1, 1, STUDENT_HEADERS.length).getValues()[0];
  return {
    name: r[C.name - 1] || 'Учень',
    input: r[C.input - 1],
    progress: r[C.progress - 1] || SEQUENCE[0],
    records: parseJSON(r[C.records - 1])
  };
}

/** Учень є лише в старій «Статистиці» — збираємо його рекорди і створюємо рядок в «Учнях». */
function migrateFromStats(deviceId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATS);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getDataRange().getValues();
  var records = {}, name = '', input = 'Новачок', found = false;

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[1]) !== String(deviceId)) continue;
    found = true;
    if (row[2]) name = row[2];
    if (row[5]) input = row[5];
    var lvl = (String(row[3]).match(/Урок\s*(\d)/) || [])[1] || '1';
    var mode = String(row[4]);
    if (MODES.indexOf(mode) === -1) continue;
    var rec = {
      score: num(row[10]), totalQuestions: num(row[6]), correct: num(row[7]), errors: num(row[8]),
      hintsCount: num(row[9]), time: num(row[11]), speed: num(row[12]),
      date: row[0] ? Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') : ''
    };
    var key = 'L' + lvl + '_' + mode;
    if (isBetter(rec, records[key])) records[key] = rec;
  }
  if (!found) return null;

  var progress = SEQUENCE[0];
  for (var s = 0; s < SEQUENCE.length; s++) {
    var parts = SEQUENCE[s].split('_');
    if (records['L' + parts[0] + '_' + parts[1]]) progress = SEQUENCE[Math.min(s + 1, SEQUENCE.length - 1)];
  }
  upsertStudent({ deviceId: deviceId, nickname: name, inputMode: input, currentCombinedLevel: progress, records: records }, false);
  return { name: name || 'Учень', input: input, progress: progress, records: records };
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

/** Номер рядка учня (швидкий пошук TextFinder, без читання всього листа) або 0. */
function findRow(sh, deviceId) {
  if (sh.getLastRow() < 2) return 0;
  var cell = sh.getRange(2, C.id, sh.getLastRow() - 1, 1)
    .createTextFinder(String(deviceId)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

/** Для кожного рівня лишаємо кращий результат; «пройдено» не скидається. */
function mergeRecords(base, incoming) {
  var out = {};
  var k;
  for (k in base) out[k] = base[k];
  if (!incoming || typeof incoming !== 'object') return out;
  for (k in incoming) {
    var rec = incoming[k];
    if (!rec || typeof rec !== 'object') continue;
    var old = out[k];
    var best = isBetter(rec, old) ? rec : old;
    var copy = {};
    for (var f in best) copy[f] = best[f];
    copy.passed = Boolean(rec.passed || (old && old.passed));
    out[k] = copy;
  }
  return out;
}

function isBetter(rec, old) {
  if (!old) return true;
  if (num(rec.score) !== num(old.score)) return num(rec.score) > num(old.score);
  return num(rec.time) < num(old.time);
}

function furthest(a, b) {
  return SEQUENCE.indexOf(String(b)) > SEQUENCE.indexOf(String(a)) ? b : (a || b || SEQUENCE[0]);
}

function totalScore(records) {
  var t = 0;
  for (var k in records) t += num(records[k] && records[k].score);
  return t;
}

function parseJSON(s) {
  try { var v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

function num(v) { return Number(v) || 0; }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
