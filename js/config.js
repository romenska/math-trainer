// Усі налаштування тренажера в одному місці. Логіка й інтерфейс їх лише читають.

export const CLOUD_URL =
  'https://script.google.com/macros/s/AKfycbwthR5KZomPf5FeA9fK_W3rEQCoAjUVh-QWVs2N9-HI7c0NNY5fonZaz7sfj7h5ijipVg/exec';
export const CLOUD_TIMEOUT_MS = 6000;

export const LESSONS = [
  // place — локація на карті: назва, персонаж-заглушка (поки немає картинки) і кольори фону.
  //   map    — де стоїть мітка уроку на загальній карті (x%, y%) — точка, куди вказує вістря краплі:
  //            у бухті між маяком і корабликом, над островом, на галявині перед будиночком-равликом,
  //            на галявині перед замком, екзамен — над фінішною стрічкою;
  //   route  — (необов'язково) проміжні точки лінії маршруту ДО наступного уроку, напр. route: [[60, 70], [80, 60]];
  //   levels — де стоять рівні на екрані локації, знизу вгору зигзагом (x%, y%).
  //   Точки підібрано під картинки фону: значки стоять на порожніх місцях (вода, галявини, пісок),
  //   не закриваючи маяк, будиночки, кораблики, замок і трасу.
  { id: 1, name: 'Урок 1: Множення на 0, 1, 2', factors: [0, 1, 2],
    place: { name: 'Драконова бухта', tile: 2, sky: '#bfe6ff', ground: '#f3dca6', map: [17, 70],
      // уздовж берега: пляж → трава → під скелю з маяком
      levels: [[10, 86], [25, 82], [40, 78], [55, 74], [68, 68], [84, 61], [76, 47], [67, 37]] } },
  { id: 2, name: 'Урок 2: Множення на 3, 4', factors: [3, 4],
    place: { name: 'Острів метеликів', tile: 3, sky: '#ffe1f0', ground: '#bfe9b0', map: [40, 20],
      // дугою вздовж берега лагуни: лівий берег → квітковий берег → правий
      levels: [[20, 82], [17, 66], [18, 50], [26, 35], [42, 28], [60, 28], [76, 36], [82, 52]] } },
  { id: 3, name: 'Урок 3: Множення на 5, 6', factors: [5, 6],
    place: { name: 'Равликове містечко', tile: 6, sky: '#e6f6d3', ground: '#a8d98a', map: [61, 93],
      // дугою вздовж краю галявини: знизу ліворуч → угору → праворуч
      levels: [[40, 82], [18, 70], [14, 55], [18, 39], [30, 25], [50, 20], [70, 25], [80, 40]] } },
  { id: 4, name: 'Урок 4: Множення на 7, 8, 9', factors: [7, 8, 9],
    place: { name: 'Королівство Глобуса', tile: 9, sky: '#e4e2ff', ground: '#b9c8ff', map: [78, 48],
      // дугою вздовж краю луки: над трасою ліворуч → під замком → праворуч
      levels: [[18, 76], [12, 61], [14, 47], [22, 35], [36, 28], [64, 28], [78, 33], [86, 45]] } },
  // Екзамен у кінці курсу: уся таблиця 1×1…9×9
  { id: 5, exam: true, name: 'Екзамен: уся таблиця множення', factors: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    place: { name: 'Екзамен', tile: 9, sky: '#fff1c9', ground: '#f6c453', map: [70, 19] } },
];
export const COURSE_LESSONS = 4;   // уроки курсу (без екзамену)

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
 *  kind      — тип завдання: 'choice' (за замовчуванням) | 'remember' | 'recall' | 'story' | 'quiz' | 'picquiz' | 'guess' | 'exam'
 *  noReveal  — після помилки не показувати правильну відповідь (екзамен)
 *  errorHint — що показати після помилки: 'text' (за замовчуванням) або 'story' (картинка-історія)
 *  lessons   — у яких уроках є рівень (якщо не вказано — у всіх)
 */
export const MODES = [
  // Перший рівень кожного уроку: знайомство з НОВИМИ картинками цього уроку (герої-цифри і добутки)
  { id: 'guess', name: 'Вгадай число', kind: 'guess', lessons: [1, 2, 3, 4], queue: 'all', retry: true, requeue: true, lives: 0,
    hints: [], tilesOn: false, tileChoices: false },
  // Знайомство з історіями: картинка-історія + текст, під числа треба покласти картинки (як у «Пригадай»)
  { id: 'stories', name: 'Історії', kind: 'story', queue: 'all', retry: 'always', requeue: false, lives: 0,
    hints: [], tilesOn: false, tileChoices: false },
  // Знайди картинку: назва, відео/картинка з озвучкою, текст історії + питання по історії; відповідь — картинка добутку з 3
  { id: 'picquiz', name: 'Знайди картинку', kind: 'picquiz', queue: 'all', retry: 'always', requeue: true, lives: 0,
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
  // Екзамен: 81 приклад по одному разу, без підказок і без другої спроби; правильну відповідь не показуємо
  { id: 'exam', name: 'Екзамен', kind: 'exam', lessons: [5], queue: 'all', retry: false, requeue: false, lives: 0, penalty: 0,
    hints: [], tilesOn: false, tileChoices: false, noReveal: true },
];

export const SCORING = {
  clean: 1,   // правильно з першої спроби без підказок
  penalty: 1, // за перший неправильний варіант у прикладі (бали не опускаються нижче 0)
};

export const FEEDBACK_MS = { right: 350, wrong: 900 };

// Послідовність проходження: урок 1 (усі рівні) → урок 2 → …
export const modesFor = lessonId => MODES.filter(m => (m.lessons
  ? m.lessons.includes(Number(lessonId)) : Number(lessonId) <= COURSE_LESSONS));
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
  //   'lvl-guess', 'lvl-associations', … — значки рівнів.
  art: [
    'map-bg', 'loc1', 'loc2', 'loc3', 'loc4', 'loc5', 'loc1-bg', 'loc2-bg', 'loc3-bg', 'loc4-bg',
    'lvl-guess', 'lvl-stories', 'lvl-associations', 'lvl-remember', 'lvl-recall', 'lvl-training', 'lvl-speed', 'lvl-records',
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
    '9x9',
  ],
};

export const getLesson = id => LESSONS.find(l => l.id === Number(id)) || LESSONS[0];
export const getMode = id => MODES.find(m => m.id === id) || MODES[0];
