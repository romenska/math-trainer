// Синхронізація з Google Таблицею (той самий Apps Script і формат даних, що й раніше).
// Головна відмінність: хмара більше НЕ блокує запуск. Інтерфейс показується одразу
// з локальних даних, а відповідь хмари підмішується, коли (і якщо) прийде.

import { CLOUD_URL, CLOUD_TIMEOUT_MS } from './config.js?v=3.46';
import { isBetter } from './engine.js?v=3.46';

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
    if (data?.status === 'not_found') return { notFound: true, records: {}, nickname: '', inputMode: null };
    if (data?.status !== 'success') return null;
    return {
      records: data.records && typeof data.records === 'object' ? data.records : {},
      nickname: typeof data.nickname === 'string' ? data.nickname : '',
      inputMode: data.inputMode === 'expert' ? 'expert' : data.inputMode === 'novice' ? 'novice' : null,
      avatar: data.avatar === undefined || data.avatar === '' ? null : String(data.avatar), // null — сервер ще не знає
      photo: typeof data.photo === 'string' ? data.photo : '',
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

/**
 * Код для перегляду статистики (у QR і на дипломі). Це хеш від ID: за ним можна лише ДИВИТИСЬ статистику,
 * а увійти (і змінити прогрес) — ні. Сам ID — це пароль учня.
 */
export async function shareCode(deviceId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mt:${deviceId}`));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Публічна статистика за кодом (без ID). */
export async function loadByCode(code) {
  const res = await fetch(`${CLOUD_URL}?action=view&code=${encodeURIComponent(code)}`);
  return res.json();
}
