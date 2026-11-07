import { STORIES } from './stories.js?v=4.58';
import { ASSETS, COURSE, OP } from './config.js?v=4.58';
// Текстові підказки-асоціації — у courses/<курс>/course.json → hints (ключ — менший×більший множник).
export const HINTS = COURSE.hints || {};
export const ZERO_ONE_HINT = COURSE.zeroOneHint || '';

const isZeroOne = (a, b) => a <= 1 || b <= 1;

/** Ключ історії: '01' для множення на 0 і 1, інакше «менший×більший». */
export const storyKey = (a, b) => (isZeroOne(a, b) ? '01' : `${Math.min(a, b)}x${Math.max(a, b)}`);
/**
 * Накласти тексти історій з Google Таблиці поверх вбудованих (STORIES змінюється на місці).
 * Беруться лише непорожні поля.
 */
export function applyStories(remote) {
  if (!remote || typeof remote !== 'object') return 0;
  let n = 0;
  for (const [key, r] of Object.entries(remote)) {
    const st = STORIES[key];
    if (!st || !r || typeof r !== 'object') continue;
    for (const f of ['title', 'text', 'voice', 'ask', 'hint']) if (typeof r[f] === 'string' && r[f].trim()) st[f] = r[f].trim();
    n++;
  }
  return n;
}

/** Історія a×b: { title, text, voice, ask, hint } або null. */
export const storyOf = (a, b) => STORIES[storyKey(a, b)] || null;

/**
 * Текстова підказка для a×b — питання з історії, яке нагадує її і натякає на відповідь
 * («У що грали два дракончики?»). Для ×0 і ×1 — питання про маяк і сонечко. Або null.
 */
export function textHint(a, b) {
  if (isZeroOne(a, b)) {
    return a === 0 || b === 0
      ? 'Пригадай історію: хто завжди перемагає — маяк чи сонечко? А сонечко — це нуль…'
      : 'Пригадай історію: маяк (1) завжди програє. Хто ж тоді перемагає?';
  }
  const st = storyOf(a, b);
  if (st?.ask) return st.ask;
  if (st?.hint) return st.hint;
  const full = HINTS[`${Math.min(a, b)}x${Math.max(a, b)}`];
  if (!full) return null;
  const m = full.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : full;
}

// Файли, знайдені в репозиторії автоматично (js/media.js): { video, image, audioStory, audioHint } → { '5x7': url }
const MEDIA = { video: {}, image: {}, audioStory: {}, audioHint: {} };
export function applyMedia(m) {
  for (const k of Object.keys(MEDIA)) MEDIA[k] = (m && typeof m[k] === 'object' && m[k]) || {};
}
/** Знайдений файл для a×b (будь-який порядок множників; ×0 і ×1 — 'zero-one'). */
function found(kind, a, b) {
  const map = MEDIA[kind];
  if (isZeroOne(a, b)) return map['zero-one'] || null;
  return map[`${a}x${b}`] || map[`${b}x${a}`] || null;
}

/** Адреса картинки-історії для a×b або null (тоді кнопку просто не показуємо). */
export function storyImage(a, b) {
  const auto = found('image', a, b);
  if (auto) return auto;
  if (isZeroOne(a, b)) return ASSETS.storyZeroOne;
  if (ASSETS.stories.includes(`${a}x${b}`)) return ASSETS.story(a, b);
  if (ASSETS.stories.includes(`${b}x${a}`)) return ASSETS.story(b, a); // 7×5 = 5×7
  return null;
}

/** Адреса відео-історії для a×b або null. */
/** Аудіо до історії: kind 'story' — озвучка історії, 'hint' — озвучка підказки. Або null. */
export function storyAudio(a, b, kind = 'story') {
  const auto = found(kind === 'hint' ? 'audioHint' : 'audioStory', a, b);
  if (auto) return auto;
  const key = storyKey(a, b);
  return (kind === 'hint' ? ASSETS.audioHint : ASSETS.audioStory).includes(key) ? ASSETS.audio(kind, key) : null;
}

export function storyVideo(a, b) {
  const auto = found('video', a, b);
  if (auto) return auto;
  if (isZeroOne(a, b)) return ASSETS.videos.includes('zero-one') ? ASSETS.video('zero-one') : null;
  for (const k of [`${a}x${b}`, `${b}x${a}`]) if (ASSETS.videos.includes(k)) return ASSETS.video(k);
  return null;
}
