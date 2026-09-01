/**
 * Die Ordner der Sidebar und ihre Farben.
 *
 * Die Farbe gehört zum Ordner, nicht zur einzelnen Quelle: im Kalender soll
 * ein Blick genügen, um Oper von Kino zu unterscheiden – dass der Abend im
 * Volkstheater oder im Residenztheater stattfindet, steht daneben. Alle
 * Quellen eines Ordners tragen deshalb denselben Ton.
 *
 * Sechs gedeckte Töne, im Farbkreis auseinandergezogen, damit sie auch als
 * 5-px-Punkt nebeneinander unterscheidbar bleiben – hell wie dunkel.
 */
export const GROUP_COLORS = {
  'Oper & Ballett': '#7A4FA0',
  Theater: '#B4472E',
  Konzert: '#3F6E8C',
  Club: '#A8557A',
  Kino: '#9C7A22',
  Literatur: '#4A7C59',
} as const;

/**
 * Ein Ordner ist keine freie Beschriftung, sondern eine Wahl aus dieser Liste.
 * Eine neue Quelle sucht sich einen bestehenden Ordner; braucht sie wirklich
 * einen neuen, wird er hier samt Farbe angelegt.
 */
export type EventGroup = keyof typeof GROUP_COLORS;

export function groupColor(group: EventGroup): string {
  return GROUP_COLORS[group];
}
