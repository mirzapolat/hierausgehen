/**
 * Die Auswahl der Quellen: eine Menge von Quellen-IDs, leer heisst alle.
 *
 * Ein Ordner (`groups.ts`) ist nur eine Abkürzung für alle seine Quellen –
 * es gibt keinen eigenen Zustand für ihn. Gewählt ist ein Ordner, wenn alle
 * seine Quellen gewählt sind; einige davon heisst: er ist eingegrenzt.
 */

export type GroupState = 'none' | 'some' | 'all';

export function groupState(selected: ReadonlySet<string>, ids: readonly string[]): GroupState {
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
}

/** Ein Klick auf den Ordner: ganz gewählt wird er abgewählt, sonst ganz gewählt. */
export function toggleGroup(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (groupState(selected, ids) === 'all') for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

/**
 * Ein Klick auf eine Quelle innerhalb ihres Ordners.
 *
 * Ist der Ordner ganz gewählt, grenzt der Klick ihn auf diese Quelle ein –
 * man tippt das Haus an, das man meint. Danach schaltet jeder Klick eine
 * Quelle dazu oder weg; wird die letzte abgewählt, gilt wieder der ganze
 * Ordner, statt dass er unter dem Finger verschwindet.
 */
export function toggleSource(selected: ReadonlySet<string>, id: string, groupIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  if (groupState(selected, groupIds) === 'all' && groupIds.length > 1) {
    for (const other of groupIds) if (other !== id) next.delete(other);
  } else if (next.delete(id)) {
    if (groupIds.length > 1 && groupState(next, groupIds) === 'none') for (const other of groupIds) next.add(other);
  } else {
    next.add(id);
  }
  return next;
}

/** Welche Quellen zu sehen sind. Eine Auswahl ohne bekannte Quelle heisst alle. */
export function visibleSources(allIds: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const chosen = allIds.filter((id) => selected.has(id));
  return new Set(chosen.length > 0 ? chosen : allIds);
}
