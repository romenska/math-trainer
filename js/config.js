// Усі налаштування тренажера в одному місці. Логіка й інтерфейс їх лише читають.

export const CLOUD_URL =
  'https://script.google.com/macros/s/AKfycbz781gyxUv2vAN8cNgK8xtLbwi7dCGAEUmANs0BjhksCKrIvJhZ7iJp7uQR-G27KrSocQ/exec';
export const CLOUD_TIMEOUT_MS = 6000;

export const LESSONS = [
  { id: 1, name: 'Урок 1: Множення на 0, 1, 2', factors: [0, 1, 2] },
  { id: 2, name: 'Урок 2: Множення на 3, 4', factors: [3, 4] },
  { id: 3, name: 'Урок 3: Множення на 5, 6', factors: [5, 6] },
  { id: 4, name: 'Урок 4: Множення на 7, 8, 9', factors: [7, 8, 9] },
];

/**
 * Правила рівнів.
 *  queue     — 'all': кожен приклад уроку один раз (у випадковому порядку); 'endless': випадкові без кінця
 *  retry     — після помилки дати ще спробу з підказкою (true) чи показати відповідь і йти далі (false)
 *  requeue   — приклад, на якому помилились, повертається в кінець черги (щоб його точно вивчили)
 *  lives     — кількість сердечок (0 = без обмежень)
 *  hints     — доступні підказки: text | story | tiles
 *  tilesOn   — картинки над числами увімкнені одразу
 *  tileChoices — варіанти відповіді показуються картинками
 *  penalty   — скільки балів знімати за помилку (якщо не вказано — SCORING.penalty)
 *  kind      — тип завдання: 'choice' (за замовчуванням) | 'remember' | 'recall'
 *  errorHint — що показати після помилки: 'text' (за замовчуванням) або 'story' (картинка-історія)
 */
export const MODES = [
  { id: 'associations', name: 'Асоціації', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text'], tilesOn: true, tileChoices: true },
  // Нові рівні: відповідь складається з кількох частин, пробуємо доки не буде правильно
  { id: 'remember', name: 'Запам’ятай', kind: 'remember', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: ['text'], errorHint: 'story', tilesOn: false, tileChoices: false },
  { id: 'recall', name: 'Пригадай', kind: 'recall', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: ['text'], errorHint: 'story', tilesOn: false, tileChoices: false },
  { id: 'training', name: 'Тренування', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text', 'story', 'tiles'], tilesOn: false, tileChoices: false },
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
export const SEQUENCE = LESSONS.flatMap(l => MODES.map(m => `${l.id}_${m.id}`));

// Зображення лежать поруч із сайтом (assets/), без запитів на інші домени.
export const ASSETS = {
  tiles: 'assets/tiles.webp',          // сітка 9×9 картинок-добутків
  zero: 'assets/zero.webp',            // сонечко для нуля
  story: (a, b) => `assets/story/${a}x${b}.webp`,
  storyZeroOne: 'assets/story/zero-one.webp',
  // Які картинки-історії є в assets/story/ (назва файлу без .webp). Нова історія = файл + назва тут.
  // 5×7 і 7×5 — одна історія: досить одного файлу будь-яким порядком.
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
