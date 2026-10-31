// Синхронізація з Google Таблицею (той самий Apps Script і формат даних, що й раніше).
// Головна відмінність: хмара більше НЕ блокує запуск. Інтерфейс показується одразу
// з локальних даних, а відповідь хмари підмішується, коли (і якщо) прийде.

import { CLOUD_URL, CLOUD_TIMEOUT_MS } from './config.js';
import { isBetter } from './engine.js';

export function newDeviceId() {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return 'dev_' + rnd[0].toString(36) + rnd[1].toString(36) + Date.now().toString(36);
}

export const looksLikeId = value => /^dev_[a-z0-9]{6,}$/i.test(value.trim());

/** Завантажити профіль. Повертає null, якщо хмара не відповіла або даних немає. */
export async function loadProfile(deviceId) {
  if (!CLOUD_URL || !deviceId) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT_MS);
  try {
    const url = `${CLOUD_URL}?action=getData&deviceId=${encodeURIComponent(deviceId)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    if (data?.status !== 'success') return null;
    return {
      records: data.records && typeof data.records === 'object' ? data.records : {},
      nickname: typeof data.nickname === 'string' ? data.nickname : '',
      inputMode: data.inputMode === 'expert' ? 'expert' : data.inputMode === 'novice' ? 'novice' : null,
      progress: typeof data.currentCombinedLevel === 'string' ? data.currentCombinedLevel : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Об'єднати рекорди: для кожного рівня лишається кращий результат. */
export function mergeRecords(local, remote) {
  const out = { ...local };
  for (const [key, rec] of Object.entries(remote || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const mine = out[key];
    const best = isBetter(rec, mine) ? { ...rec } : { ...mine };
    best.passed = Boolean(rec.passed || mine?.passed);
    out[key] = best;
  }
  return out;
}

/** Надіслати результат гри. «Вистрілив і забув»: keepalive доставить запит, навіть якщо вкладку закрили. */
export function pushResult(payload) {
  if (!CLOUD_URL || !payload.deviceId) return;
  fetch(CLOUD_URL, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // «простий» запит — без preflight
    body: JSON.stringify(payload),
  }).catch(() => {});
}
