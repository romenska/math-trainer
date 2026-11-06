// Історії курсу (назва, текст, текст озвучки, підказка, питання) — тепер у courses/<курс>/course.json → stories.
// Ключ — менший×більший множник; '01' — історія для множення на 0 і 1.
import { COURSE } from './config.js?v=4.44';

export const STORIES = COURSE.stories || {};
