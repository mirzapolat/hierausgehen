/**
 * Die Ordner der Sidebar und ihre Farben.
 *
 * Die Farbe gehört zum Ordner, nicht zur einzelnen Quelle: im Kalender soll
 * ein Blick genügen, um Oper von Kino zu unterscheiden – dass der Abend im
 * Volkstheater oder im Residenztheater stattfindet, steht daneben. Alle
 * Quellen eines Ordners tragen deshalb denselben Ton.
 *
 * Ruhige Pastelltöne, einmal rund um den Farbkreis verteilt – Lavendel,
 * Koralle, Himmelblau, Rosé, Butter, Salbei, Mint –, damit kein Ton
 * überwiegt und jeder auch als 5-px-Punkt vom Nachbarn zu unterscheiden ist.
 * Hell genug für Flächen, satt genug, um auf Weiss noch zu tragen.
 *
 * Auf einer Fläche in Ordnerfarbe steht Schrift deshalb dunkel, nie weiss –
 * siehe `inkOn`.
 */
export const GROUP_COLORS = {
  'Oper & Ballett': '#B4A2DE',
  Theater: '#EFA294',
  Konzert: '#94BEE4',
  Club: '#E2A3CB',
  Kino: '#E8C97A',
  Literatur: '#A3CD9C',
  Kultur: '#86CFC2',
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

/**
 * Schrift auf einer Fläche in Ordnerfarbe: derselbe Ton, tief abgedunkelt.
 * Auf Pastell wäre Weiss kaum lesbar, und Schwarz wirkte fremd. Gilt in
 * hellem wie dunklem Schema gleich, denn die Fläche ändert sich nicht.
 */
export function inkOn(color: string): string {
  return `color-mix(in srgb, ${color} 28%, #141416)`;
}
