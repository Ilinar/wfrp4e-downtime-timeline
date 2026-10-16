/**
 * Stałe modułu + drobne helpery wspólne dla całego kodu.
 */

export const MODULE_ID = "wfrp4e-downtime-timeline";

/** Klucz flagi przechowującej listę zajęć na aktorze. */
export const FLAG_ACTIVITIES = "activities";

/**
 * Rejestr typów przedsięwzięć (endeavour).
 *  - realizes: czy „realizuje dzień" — wtedy po wykonaniu naliczamy koszt utrzymania.
 *              rest = false (nie zużywa dnia, nie nalicza kosztu, osobna sekcja).
 */
export const ENDEAVOURS = {
  test: { realizes: true },
  extended: { realizes: true },
  income: { realizes: true },
  adventure: { realizes: true },
  healing: { realizes: true },
  rest: { realizes: false },
};

/** Dostępne typy zajęć. */
export const ACTIVITY_TYPES = Object.keys(ENDEAVOURS);

/** Ile dni pokazujemy domyślnie na osi (tydzień WFRP = 8 dni). */
export const DEFAULT_DAYS_TO_SHOW = 8;

/**
 * Koszt utrzymania = 3 pola (bp na 1 POZIOM standingu); klucz tier = LITERA WFRP4e:
 * "b"=Brąz, "s"=Srebro, "g"=Złoto (actor.system.details.status.tier).
 * Koszt dnia = pole(tier) × standing. 12 bp = 1 ss, 240 bp = 1 gc (ułamki — round przy płatności).
 */
export const DEFAULT_COST_PER_LEVEL = { b: 1.5, s: 8, g: 48 };

/**
 * Dopłata za leczenie u Szaljanek za KAŻDĄ dolegliwość — EDYTOWALNA FORMUŁA per tier.
 * Zmienne: `daily` (koszt dnia) i `standing`. Dzień leczenia = koszt dnia + formuła × liczba_dolegliwości.
 * Domyślnie reguły RAW: Brąz „daily - 3", Srebro „standing * 5", Złoto „standing * 30".
 */
export const DEFAULT_HEAL_RULE = { b: "daily - 3", s: "standing * 5", g: "standing * 30" };

/**
 * Modyfikator do CELU testów robionych z osi (Test/Wydłużony/Dochód) wg statusu Z KARTY.
 * Stawka za 1 poziom danego tieru; sumowane KUMULATYWNIE po drabinie (Brąz→Srebro→Złoto), zaokrąglane w górę.
 * Tylko rzuty z modułu. 0/0/0 = wyłączone.
 */
export const DEFAULT_ROLL_MOD_RATE = { b: 0.5, s: 1, g: 1.5 };

/**
 * Renderuje szablon Handlebars niezależnie od wersji Foundry.
 * v13: foundry.applications.handlebars.renderTemplate, v12: globalny renderTemplate.
 */
export function renderTpl(path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return fn(path, data);
}

/** Skrócony localize. */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}
