// Автоматичний пошук медіафайлів (відео, картинки, аудіо) у репозиторії сайту на GitHub.
// Завантажили файл у потрібну папку — тренажер побачить його сам, без правок коду:
//   assets/story/*.mp4          — відео історій   (5x7.mp4, 7x5.mp4, zero-one.mp4)
//   assets/story/*.webp|.jpg|.png — картинки історій
//   assets/audio/story/*.mp3     — озвучка історій (2x3.mp3, zero-one.mp3)
//   assets/audio/hint/*.mp3      — озвучка підказок
// Назва — два множники через «x» (можна й українською «х» або «×»): 5x7, 5х7, 7x5 — одна історія.
// Список файлів береться з GitHub API (один запит на папку) і зберігається на пристрої на 10 хвилин.

import { GITHUB_REPO, ASSETS } from './config.js?v=4.44';

const CACHE_KEY = 'math_trainer_media';
const TTL_MS = 10 * 60 * 1000;
const DIRS = { story: 'assets/story', audioStory: 'assets/audio/story', audioHint: 'assets/audio/hint', ...ASSETS.mediaDirs };

/** «5х7.mp4» → { key: '5x7', ext: 'mp4' }; «zero-one.mp3» або «1x0.mp3» → key 'zero-one'. */
export function parseMediaName(name) {
  const m = String(name).toLowerCase().replace(/[хx×*]/g, 'x').match(/^(?:(\d)x(\d)|zero-one|01)\.([a-z0-9]+)$/);
  if (!m) return null;
  const ext = m[3];
  if (!m[1]) return { key: 'zero-one', ext };
  const a = Number(m[1]), b = Number(m[2]);
  return { key: a <= 1 || b <= 1 ? 'zero-one' : `${a}x${b}`, ext };
}

/** Відповідь GitHub API (список файлів папки) → { key: url }. */
export function indexFiles(dir, files, exts) {
  const out = {}, sizes = {};
  for (const f of Array.isArray(files) ? files : []) {
    if (f?.type !== 'file') continue;
    const p = parseMediaName(f.name);
    if (!p || !exts.includes(p.ext)) continue;
    // два файли однієї історії (напр. «5x5.mp4» і «5х5.mp4») — беремо менший: він швидше завантажиться
    if (out[p.key] && sizes[p.key] <= (f.size || 0)) continue;
    sizes[p.key] = f.size || 0;
    // версія — за вмістом файлу: замінили файл — адреса нова, телефон не покаже старий з кешу
    out[p.key] = `${dir}/${encodeURIComponent(f.name)}?h=${String(f.sha || '').slice(0, 8)}`;
  }
  return out;
}

async function listDir(dir) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${dir}`, { signal: ctrl.signal });
    if (res.status === 404) return [];          // папки ще немає — це нормально
    if (!res.ok) return null;                   // ліміт запитів або збій — лишаємо, що знали
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

/**
 * Знайти медіафайли. onFound(media) викликається одразу з даними з пристрою (якщо є)
 * і ще раз — зі свіжими даними з GitHub (якщо кеш застарів).
 */
export async function discoverMedia(onFound) {
  const cached = readCache();
  if (cached?.data) onFound(cached.data);
  if (!GITHUB_REPO || (cached && Date.now() - cached.t < TTL_MS)) return;
  const [story, aStory, aHint] = await Promise.all([listDir(DIRS.story), listDir(DIRS.audioStory), listDir(DIRS.audioHint)]);
  if (story === null && aStory === null && aHint === null) return;
  const old = cached?.data || {};
  const data = {
    video: story === null ? old.video || {} : indexFiles(DIRS.story, story, ['mp4', 'webm', 'mov']),
    image: story === null ? old.image || {} : indexFiles(DIRS.story, story, ['webp', 'jpg', 'jpeg', 'png']),
    audioStory: aStory === null ? old.audioStory || {} : indexFiles(DIRS.audioStory, aStory, ['mp3', 'm4a', 'ogg', 'wav']),
    audioHint: aHint === null ? old.audioHint || {} : indexFiles(DIRS.audioHint, aHint, ['mp3', 'm4a', 'ogg', 'wav']),
  };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch { /* сховище недоступне */ }
  onFound(data);
}
