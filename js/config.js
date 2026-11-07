import { OPERATIONS } from './ops.js?v=4.52';
// Налаштування гри. Увесь вміст курсу (уроки, рівні, тексти, історії, персонажі, карта, картинки)
// лежить окремо — у courses/<курс>/course.json. Цей файл лише завантажує його і дає решті коду
// ті самі назви, що й раніше (LESSONS, MODES, ASSETS, …).
//
// Інший курс: courses/<назва>/course.json і адреса сайту з ?course=<назва>
// (вибір запам'ятовується на пристрої; ?course=multiplication — повернутись до множення).

const DEFAULT_COURSE = 'multiplication';

function pickCourse() {
  if (typeof location === 'undefined') return DEFAULT_COURSE;
  let id = null;
  try { id = new URLSearchParams(location.search).get('course'); } catch { /* немає адреси */ }
  const ok = s => /^[a-z0-9_-]{1,40}$/i.test(s || '');
  try {
    if (ok(id)) localStorage.setItem('math_trainer_course', id);
    else id = localStorage.getItem('math_trainer_course');
  } catch { /* сховище недоступне */ }
  return ok(id) ? id : DEFAULT_COURSE;
}

export const COURSE_ID = pickCourse();
const courseUrl = new URL(`../courses/${COURSE_ID}/course.json?v=4.52`, import.meta.url);

async function loadCourse() {
  if (typeof window === 'undefined') {                      // тести в Node: читаємо файл з диска
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return JSON.parse(readFileSync(fileURLToPath(courseUrl), 'utf8'));
  }
  const res = await fetch(courseUrl);
  if (!res.ok && COURSE_ID !== DEFAULT_COURSE) {             // такого курсу немає — відкриваємо основний
    try { localStorage.removeItem('math_trainer_course'); } catch { /* */ }
    return (await fetch(new URL(`../courses/${DEFAULT_COURSE}/course.json?v=4.52`, import.meta.url))).json();
  }
  return res.json();
}

/** Увесь курс як є (тексти, історії, підказки, персонажі…). */
export const COURSE = await loadCourse();

// Підстановка в шаблон шляху: fill('assets/story/{key}.webp', { key: '2x3' })
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/** Арифметична дія курсу: mul | add | sub | div (course.json → operation). */
export const OP_ID = OPERATIONS[COURSE.operation] ? COURSE.operation : 'mul';
export const OP = OPERATIONS[OP_ID];

export const GITHUB_REPO = COURSE.backend?.githubRepo || '';
export const CLOUD_URL = COURSE.backend?.cloudUrl || '';
export const CLOUD_TIMEOUT_MS = COURSE.backend?.timeoutMs || 6000;

/**
 * Уроки: id, name, factors, exam?, place { name, tile, theme, entry, exit, spots?, gate? } — spots/gate у % картинки уроку.
 * Правила рівнів (modes) описано в course.json; коротко:
 *  queue 'all' | 'endless'; retry true | 'always' | false; requeue; lives (0 — без обмежень);
 *  hints: text | story | video | tiles; tilesOn; tileChoices; penalty; kind; noReveal; typed; choicesOnly;
 *  errorHint; lessons; hidden; strict; secPerQuestion (темп); timeLimit; passPct; icon; rules (текст правил).
 */
export const LESSONS = COURSE.lessons;
export const COURSE_LESSONS = COURSE.courseLessons ?? LESSONS.filter(l => !l.exam).length;
export const MODES = COURSE.modes;
export const SCORING = COURSE.scoring || { clean: 1, penalty: 1 };
export const FEEDBACK_MS = COURSE.feedbackMs || { right: 350, wrong: 900 };
export const TEXTS = COURSE.texts || {};
export const HEROES_CFG = COURSE.heroes;
export const MAP_CFG = COURSE.map || {};

// Послідовність проходження: урок 1 (усі рівні) → урок 2 → …
export const modesFor = lessonId => MODES.filter(m => !m.hidden && (m.lessons
  ? m.lessons.includes(Number(lessonId)) : Number(lessonId) <= COURSE_LESSONS));
export const SEQUENCE = LESSONS.flatMap(l => modesFor(l.id).map(m => `${l.id}_${m.id}`));

// Шляхи до картинок, відео й аудіо — шаблони з course.json
const A = COURSE.assets || {};
export const ASSETS = {
  tiles: A.tiles,
  zero: A.zero,
  story: (a, b) => `${fill(A.story, { key: `${a}x${b}` })}?v=4.52`,
  storyZeroOne: `${fill(A.story, { key: 'zero-one' })}?v=4.52`,
  art: A.artList || [],
  artUrl: name => fill(A.art, { name }),
  videos: A.videos || [],
  video: key => fill(A.video, { key }),
  audioStory: A.audioStory || [],
  audioHint: A.audioHint || [],
  audio: (kind, key) => `${fill(A.audio, { kind, key })}?v=4.52`,
  stories: A.stories || [],
  mediaDirs: A.mediaDirs || {},
  mapImage: id => fill(MAP_CFG.image || 'assets/map/lesson{id}.webp', { id }),
  hero: n => fill(HEROES_CFG?.image || 'assets/avatars/{n}.webp', { n }),
};

export const getLesson = id => LESSONS.find(l => l.id === Number(id)) || LESSONS[0];
export const getMode = id => MODES.find(m => m.id === id) || MODES[0];
