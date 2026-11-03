// Синхронізація з Google Таблицею (той самий Apps Script і формат даних, що й раніше).
// Головна відмінність: хмара більше НЕ блокує запуск. Інтерфейс показується одразу
// з локальних даних, а відповідь хмари підмішується, коли (і якщо) прийде.

import { CLOUD_URL, CLOUD_TIMEOUT_MS } from './config.js?v=4.07';
import { isBetter } from './engine.js?v=4.07';

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
      examHistory: Array.isArray(data.examHistory) ? data.examHistory : null,   // null — старий скрипт
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

/** Тексти історій з листа «Історії» (або null, якщо хмара не відповіла). */
export async function loadStories() {
  if (!CLOUD_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT_MS * 2);
  try {
    const res = await fetch(`${CLOUD_URL}?action=stories`, { signal: ctrl.signal });
    const data = await res.json();
    return data?.status === 'success' && data.stories && typeof data.stories === 'object' ? data.stories : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Журнал входів (лист «Входи») ----------

/** Коротко про браузер і систему з userAgent: «Chrome 130», «Android 14». */
export function describeAgent(ua = navigator.userAgent) {
  const m = (re) => (ua.match(re) || [])[1];
  const browser = m(/EdgA?\/([\d]+)/) ? `Edge ${m(/EdgA?\/([\d]+)/)}`
    : m(/SamsungBrowser\/([\d]+)/) ? `Samsung Internet ${m(/SamsungBrowser\/([\d]+)/)}`
    : m(/OPR\/([\d]+)/) ? `Opera ${m(/OPR\/([\d]+)/)}`
    : m(/Firefox\/([\d]+)/) ? `Firefox ${m(/Firefox\/([\d]+)/)}`
    : m(/CriOS\/([\d]+)/) ? `Chrome ${m(/CriOS\/([\d]+)/)} (iOS)`
    : m(/Chrome\/([\d]+)/) ? `Chrome ${m(/Chrome\/([\d]+)/)}${/; wv\)/.test(ua) ? ' (WebView)' : ''}`
    : m(/Version\/([\d.]+).*Safari/) ? `Safari ${m(/Version\/([\d.]+).*Safari/)}` : 'інший';
  const os = m(/Android ([\d.]+)/) ? `Android ${m(/Android ([\d.]+)/)}`
    : m(/(?:iPhone|CPU) OS ([\d_]+)/) ? `iOS ${m(/(?:iPhone|CPU) OS ([\d_]+)/).replace(/_/g, '.')}`
    : /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'інша';
  return { browser, os };
}

/** IP і країна — з відкритого сервісу api.country.is (ключ не потрібен). Не відповів за 4 с — без них. */
async function ipInfo() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const d = await (await fetch('https://api.country.is/', { signal: ctrl.signal })).json();
    const code = String(d.country || '');
    let name = '';
    try { name = code ? new Intl.DisplayNames(['uk'], { type: 'region' }).of(code) : ''; } catch { /* старий браузер */ }
    return { ip: String(d.ip || ''), country: name && name !== code ? `${name} (${code})` : code };
  } catch {
    return { ip: '', country: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Записати вхід у лист «Входи». kind: 'реєстрація' | 'вхід' (паролем) | 'запуск' (відкрив тренажер). */
export async function logLogin(deviceId, nickname, kind) {
  if (!CLOUD_URL || !deviceId) return;
  const { browser, os } = describeAgent();
  const { ip, country } = await ipInfo();
  pushResult({
    action: 'login', deviceId, nickname, kind, ip, country, browser, os,
    app: matchMedia('(display-mode: standalone)').matches ? 'встановлений' : 'у браузері',
    screen: `${screen.width}×${screen.height}`, lang: navigator.language || '', ua: navigator.userAgent,
  });
}
