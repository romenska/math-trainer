// Усі налаштування тренажера в одному місці. Логіка й інтерфейс їх лише читають.

export const CLOUD_URL =
  'https://script.google.com/macros/s/AKfycbyrbH79zc6DehwLctiMVqvyBtwZjoJMNfbtbw9yjeHsuK8sJIitnEG4DwDl9-gsrfIJCw/exec';
export const CLOUD_TIMEOUT_MS = 6000;

export const LESSONS = [
  // place — локація на карті: назва, персонаж-заглушка (поки немає картинки) і кольори фону
  { id: 1, name: 'Урок 1: Множення на 0, 1, 2', factors: [0, 1, 2],
    place: { name: 'Драконова бухта', tile: 2, sky: '#bfe6ff', ground: '#f3dca6' } },
  { id: 2, name: 'Урок 2: Множення на 3, 4', factors: [3, 4],
    place: { name: 'Острів метеликів', tile: 3, sky: '#ffe1f0', ground: '#bfe9b0' } },
  { id: 3, name: 'Урок 3: Множення на 5, 6', factors: [5, 6],
    place: { name: 'Равликове містечко', tile: 6, sky: '#e6f6d3', ground: '#a8d98a' } },
  { id: 4, name: 'Урок 4: Множення на 7, 8, 9', factors: [7, 8, 9],
    place: { name: 'Королівство Глобуса', tile: 9, sky: '#e4e2ff', ground: '#b9c8ff' } },
];

/**
 * Правила рівнів.
 *  queue     — 'all': кожен приклад уроку один раз (у випадковому порядку); 'endless': випадкові без кінця
 *  retry     — після помилки дати ще спробу з підказкою (true) чи показати відповідь і йти далі (false)
 *  requeue   — приклад, на якому помилились, повертається в кінець черги (щоб його точно вивчили)
 *  lives     — кількість сердечок (0 = без обмежень)
 *  hints     — доступні підказки: text | story (картинка) | video (відео-історія) | tiles
 *  tilesOn   — картинки над числами увімкнені одразу
 *  tileChoices — варіанти відповіді показуються картинками
 *  penalty   — скільки балів знімати за помилку (якщо не вказано — SCORING.penalty)
 *  kind      — тип завдання: 'choice' (за замовчуванням) | 'remember' | 'recall' | 'story' | 'digit' | 'number'
 *  errorHint — що показати після помилки: 'text' (за замовчуванням) або 'story' (картинка-історія)
 *  lessons   — у яких уроках є рівень (якщо не вказано — у всіх)
 */
export const MODES = [
  // Початкові рівні: вивчаємо самі картинки-асоціації (лише в уроці 1)
  { id: 'digits', name: 'Вгадай цифру', kind: 'digit', lessons: [1], queue: 'all', retry: true, requeue: true, lives: 0,
    hints: [], tilesOn: false, tileChoices: false },
  { id: 'numbers', name: 'Вгадай число', kind: 'number', lessons: [1], queue: 'all', retry: true, requeue: true, lives: 0,
    hints: [], tilesOn: false, tileChoices: false },
  // Знайомство з історіями: картинка-історія + текст, під числа треба покласти картинки (як у «Пригадай»)
  { id: 'stories', name: 'Історії', kind: 'story', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: [], tilesOn: false, tileChoices: false },
  { id: 'associations', name: 'Асоціації', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text'], tilesOn: true, tileChoices: true },
  // Нові рівні: відповідь складається з кількох частин, пробуємо доки не буде правильно
  { id: 'remember', name: 'Запам’ятай', kind: 'remember', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: ['text'], errorHint: 'story', tilesOn: false, tileChoices: false },
  { id: 'recall', name: 'Пригадай', kind: 'recall', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: ['text'], errorHint: 'story', tilesOn: false, tileChoices: false },
  { id: 'training', name: 'Тренування', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text', 'story', 'video', 'tiles'], tilesOn: false, tileChoices: false },
  { id: 'speed', name: 'Перевірка', queue: 'all', retry: false, requeue: false, lives: 3,
    hints: [], tilesOn: false, tileChoices: false },
  { id: 'records', name: 'Марафон', queue: 'endless', retry: false, requeue: false, lives: 1, penalty: 0, // до першої помилки, бали не знімаються
    hints: [], tilesOn: false, tileChoices: false },
];

export const SCORING = {
  clean: 1,   // правильно з першої спроби без підказок
  penalty: 1, // за перший неправильний варіант у прикладі (бали не опускаються нижче 0)
};

export const FEEDBACK_MS = { right: 350, wrong: 900 };

// Послідовність проходження: урок 1 (усі рівні) → урок 2 → …
export const modesFor = lessonId => MODES.filter(m => !m.lessons || m.lessons.includes(Number(lessonId)));
export const SEQUENCE = LESSONS.flatMap(l => modesFor(l.id).map(m => `${l.id}_${m.id}`));

// Зображення лежать поруч із сайтом (assets/), без запитів на інші домени.
export const ASSETS = {
  tiles: 'assets/tiles.webp',          // сітка 9×9 картинок-добутків
  zero: 'assets/zero.webp',            // сонечко для нуля
  story: (a, b) => `assets/story/${a}x${b}.webp`,
  storyZeroOne: 'assets/story/zero-one.webp',
  // Картинки карти. Поки файлу немає — показується намальована заглушка.
  // Коли картинку додано в assets/map/, допишіть її назву сюди (без .webp):
  //   'map-bg' — фон карти; 'loc1'…'loc4' — значки локацій; 'loc1-bg'…'loc4-bg' — фони екранів локацій;
  //   'lvl-digits', 'lvl-numbers', 'lvl-associations', … — значки рівнів.
  art: [
    'map-bg', 'loc1', 'loc2', 'loc3', 'loc4', 'loc1-bg', 'loc2-bg', 'loc3-bg', 'loc4-bg',
    'lvl-digits', 'lvl-numbers', 'lvl-stories', 'lvl-associations', 'lvl-remember', 'lvl-recall', 'lvl-training', 'lvl-speed', 'lvl-records',
  ],
  artUrl: name => `assets/map/${name}.webp`,
  // Які картинки-історії є в assets/story/ (назва файлу без .webp). Нова історія = файл + назва тут.
  // 5×7 і 7×5 — одна історія: досить одного файлу будь-яким порядком.
  // Відео-історії (assets/story/AxB.mp4, зі звуком). Якщо відео є — показується воно, інакше картинка.
  videos: [
    '2x2', '2x3', '2x4', '2x5', '2x6', '2x7', '2x8', '2x9',
    '3x3', '3x4', '3x5', '3x6', '3x7', '3x8', '3x9',
    '4x3', '4x4', '4x5', '4x6', '4x7', '4x8', '4x9',
  ],
  video: key => `assets/story/${key}.mp4`,
  stories: [
    '2x2', '2x3', '2x4', '2x5', '2x6', '2x7', '2x8', '2x9',
    '3x2', '3x3', '3x4', '3x5', '3x6', '3x7', '3x8', '3x9',
    '4x2', '4x3', '4x4', '4x5', '4x6', '4x7', '4x8', '4x9',
    '5x5', '5x6', '5x7', '5x8', '5x9',
    '6x6', '6x7', '6x8', '6x9',
    '7x7', '7x8', '7x9',
    '8x8', '8x9',
  ],
};

export const getLesson = id => LESSONS.find(l => l.id === Number(id)) || LESSONS[0];
export const getMode = id => MODES.find(m => m.id === id) || MODES[0];
