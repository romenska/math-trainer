// Локальне збереження. Ключі ті самі, що в старій версії, — прогрес учнів не загубиться.
// При виході видаляються ЛИШЕ ці ключі (localStorage.clear() стирав би дані
// всіх інших сайтів на romenska.github.io — у них спільне сховище).

const KEYS = {
  deviceId: 'math_trainer_device_id',
  nickname: 'math_trainer_nickname',
  records: 'math_trainer_records',
  progress: 'math_trainer_combined_level',
  settings: 'math_trainer_settings',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватний режим — працюємо без збереження */ }
}
function readJSON(key, fallback) {
  try { return JSON.parse(read(key, '')) ?? fallback; } catch { return fallback; }
}

export const storage = {
  load() {
    const settings = readJSON(KEYS.settings, {});
    return {
      deviceId: read(KEYS.deviceId, ''),
      nickname: read(KEYS.nickname, ''),
      records: readJSON(KEYS.records, {}),
      progress: read(KEYS.progress, '1_associations'),
      inputMode: settings.inputMode === 'expert' ? 'expert' : 'novice',
    };
  },
  saveProfile({ deviceId, nickname }) {
    write(KEYS.deviceId, deviceId);
    write(KEYS.nickname, nickname || '');
  },
  saveRecords(records) { write(KEYS.records, JSON.stringify(records)); },
  saveProgress(stage) { write(KEYS.progress, stage); },
  saveInputMode(inputMode) { write(KEYS.settings, JSON.stringify({ inputMode })); },
  clear() {
    try { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  },
};
