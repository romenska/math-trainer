// Усі налаштування тренажера в одному місці. Логіка й інтерфейс їх лише читають.

export const CLOUD_URL =
  'https://script.google.com/macros/s/AKfycbx-rseEh_Ek4bPJ7f5TfvYwr9Abq_XyOO_R5i5vscfXczkFfHJ63JKzyH4KypfEy-c3uw/exec';
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
 */
export const MODES = [
  { id: 'associations', name: 'Асоціації', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text'], tilesOn: true, tileChoices: true },
  { id: 'training', name: 'Тренування', queue: 'all', retry: true, requeue: true, lives: 0,
    hints: ['text', 'story', 'tiles'], tilesOn: false, tileChoices: false },
  { id: 'speed', name: 'Перевірка', queue: 'all', retry: false, requeue: false, lives: 3,
    hints: [], tilesOn: false, tileChoices: false },
  { id: 'records', name: 'Марафон', queue: 'endless', retry: false, requeue: false, lives: 3,
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
  storyFactors: [2, 3, 4],             // для яких множників є картинки-історії
};

export const getLesson = id => LESSONS.find(l => l.id === Number(id)) || LESSONS[0];
export const getMode = id => MODES.find(m => m.id === id) || MODES[0];
