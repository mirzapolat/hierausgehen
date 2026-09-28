import assert from 'node:assert/strict';
import test from 'node:test';
import { isFreeEntry } from './price.ts';

const free = (...notes: string[]) => isFreeEntry({ notes });

test('erkennt die Wortlaute der Quellen', () => {
  for (const line of [
    'Eintritt frei', // Gasteig, HMTM, Wilhelm13
    'Preise Eintritt frei', // Residenztheater
    'Preise: Kostenlos', // Deutsches Theater
    'Kostenfrei', // Kammerspiele
    'Eintritt frei - Spende erbeten', // Kulturetage
    'Eintritt frei; Einlasskarte erforderlich',
    'Teilnahme kostenlos; Anmeldung erforderlich',
    'Hier kostenlos anmelden',
    'Tickets: Free - ticket required', // Glasgow Life
    'Free - Drop-in - no ticket required',
    'Tickets: Free but Ticketed', // Tron
  ]) {
    assert.equal(free(line), true, line);
  }
  assert.equal(isFreeEntry({ availabilityLabel: 'Kostenlos' }), true);
});

test('ein Preis in derselben Zeile hebt es auf', () => {
  assert.equal(free('Eintritt frei mit Wannda-Bändchen, 10€ Vorverkauf, 15€ Kasse'), false);
  assert.equal(free('Eintritt: 15 €'), false);
  assert.equal(free('Tickets: £7.50'), false);
});

test('Preise, Platzhalter und Fliesstext zählen nicht', () => {
  for (const line of ['Eintritt 6/11', 'neuer Eintrittspreis', 'Freiluftbühne', 'Freitag, 20 Uhr', 'Frei.Wild live']) {
    assert.equal(free(line), false, line);
  }
  assert.equal(isFreeEntry({}), false);
  // Der Programmtext ist kein Signal – nur `notes` und die Ticketlage.
  assert.equal(
    isFreeEntry({ notes: ['Vorverkauf 20 EUR'], availabilityLabel: undefined, description: 'feel free' } as never),
    false,
  );
});
