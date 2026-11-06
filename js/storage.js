import { COURSE_ID } from './config.js?v=4.47';
// Локальне збереження. Ключі ті самі, що в старій версії, — прогрес учнів не загубиться.
// При виході видаляються ЛИШЕ ці ключі (localStorage.clear() стирав би дані
// всіх інших сайтів на romenska.github.io — у них спільне сховище).

// Прогрес і налаштування — окремо для кожного курсу (основний курс — старі назви, щоб нічого не загубилось)
const P = COURSE_ID === 'multiplication' ? 'math_trainer_' : `course_${COURSE_ID}_`;
const KEYS = {
  deviceId: 'math_trainer_device_id',
  nickname: 'math_trainer_nickname',
  records: `${P}records`,
  progress: 'math_trainer_combined_level', // більше не використовується (прогрес рахується з рекордів); лишився, щоб «Вийти» його прибрав
  settings: `${P}settings`,
  avatar: 'math_trainer_avatar',   // номер аватарки 0–13 (assets/avatars) або «photo»
  photo: 'math_trainer_photo',     // фото обличчя (data:image/jpeg;base64,…)
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
      progress: null, // обчислюється в normalizeProgress() з пройдених рівнів
      inputMode: settings.inputMode === 'expert' ? 'expert' : 'novice',
      avatar: read(KEYS.avatar, '13'),   // зелений дракончик   // за замовчуванням — дракончик
      photo: read(KEYS.photo, ''),
    };
  },
  saveProfile({ deviceId, nickname }) {
    write(KEYS.deviceId, deviceId);
    write(KEYS.nickname, nickname || '');
  },
  saveAvatar({ avatar, photo }) { write(KEYS.avatar, String(avatar)); write(KEYS.photo, photo || ''); },
  saveRecords(records) { write(KEYS.records, JSON.stringify(records)); },
  saveInputMode(inputMode) { write(KEYS.settings, JSON.stringify({ inputMode })); },
  clear() {
    try { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  },
};
