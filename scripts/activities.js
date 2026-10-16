/**
 * Warstwa danych: zajęcia trzymane jako flaga na aktorze.
 *
 * Źródłem prawdy jest flaga actor.flags[MODULE_ID].activities (tablica obiektów).
 * Dzięki temu właściciel aktora (gracz) może czytać i zapisywać własne zajęcia
 * bez uprawnień GM i bez socketów.
 *
 * Schemat zajęcia:
 *   { id, type: "test"|"extended"|"income", label, timestamp, status, log,
 *     roll?: { kind: "skill"|"char", value },   // dla "test"
 *     extendedTestId? }                          // dla "extended" (id itemu na karcie)
 */

import { MODULE_ID, FLAG_ACTIVITIES, t } from "./const.js";

/** Pobiera (kopię) listy zajęć aktora, z lekką migracją starych wpisów. */
export function getActivities(actor) {
  const list = actor?.getFlag(MODULE_ID, FLAG_ACTIVITIES) ?? [];
  return foundry.utils.deepClone(list).map(migrate);
}

/** Lekka migracja danych z v0.1.x. */
function migrate(a) {
  if (a.type === "earning") a.type = "income"; // stary typ
  if (a.skill && !a.roll) a.roll = { kind: "skill", value: a.skill }; // stare pole skill
  return a;
}

/** Zapisuje całą listę zajęć aktora. */
export function setActivities(actor, list) {
  return actor.setFlag(MODULE_ID, FLAG_ACTIVITIES, list);
}

/** Pojedyncze zajęcie po id. */
export function getActivity(actor, id) {
  return getActivities(actor).find((a) => a.id === id) ?? null;
}

/** Buduje obiekt zajęcia z domyślnymi polami. */
function normalizeActivity(data = {}) {
  return {
    id: foundry.utils.randomID(),
    type: data.type ?? "test",
    label: data.label ?? "",
    timestamp: Number(data.timestamp) || 0,
    status: data.status ?? "planned",
    roll: data.roll ?? null,
    extendedTestId: data.extendedTestId ?? null,
    extDay: data.extDay ?? false,
    note: data.note ?? "",
    ailments: Number(data.ailments) || 0,
    upkeep: data.upkeep ?? true, // czy nalicza koszt utrzymania (przygoda może wyłączyć)
    costBp: Number(data.costBp) || 0, // ZAMROŻONY koszt utrzymania (bp) z chwili rozliczenia
    paid: data.paid ?? false, // czy koszt zaakceptowany/pobrany (chip na osi dopiero po zapłacie)
    earnedBp: Number(data.earnedBp) || 0, // zarobek dnia (bp) — do sumy w połączonej komórce

    log: Array.isArray(data.log) ? data.log : [],
  };
}

/** Tworzy nowe zajęcie i dopisuje do aktora. */
export async function addActivity(actor, data = {}) {
  const list = getActivities(actor);
  const activity = normalizeActivity(data);
  list.push(activity);
  await setActivities(actor, list);
  return activity;
}

/** Hurtowo dopisuje wiele zajęć jednym zapisem (batch / tryb wielu dni). */
export async function addActivities(actor, dataList = []) {
  if (!dataList.length) return [];
  const list = getActivities(actor);
  const created = dataList.map(normalizeActivity);
  list.push(...created);
  await setActivities(actor, list);
  return created;
}

/** Aktualizuje zajęcie (deep-merge patcha). */
export async function updateActivity(actor, id, patch) {
  const list = getActivities(actor);
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  list[idx] = foundry.utils.mergeObject(list[idx], patch, { inplace: false });
  await setActivities(actor, list);
  return list[idx];
}

/**
 * Modyfikator „standardu życia" (status używany do KOSZTU utrzymania): offset stopni drabiny
 * względem statusu z karty. Trzymany jako flaga aktora (gracz zarządza swoją). Bez limitu ±1 —
 * granicę drabiny (efektywny status 0..14) pilnuje wołający (#wireStatus) i fromLadder (templates.js).
 * Tu trzymamy tylko sane całkowite [-14,14], żeby nie urosło bez sensu.
 */
export function getStandingOffset(actor) {
  const v = Math.trunc(Number(actor?.getFlag?.(MODULE_ID, "standingOffset")) || 0);
  return Math.max(-14, Math.min(14, v));
}
export function setStandingOffset(actor, off) {
  const v = Math.max(-14, Math.min(14, Math.trunc(Number(off) || 0)));
  return actor.setFlag(MODULE_ID, "standingOffset", v);
}

/** Usuwa zajęcie. */
export async function removeActivity(actor, id) {
  const list = getActivities(actor).filter((a) => a.id !== id);
  return setActivities(actor, list);
}

/** Czy aktor to karta gracza (postać z właścicielem-graczem)? */
function isPlayerCharacter(actor) {
  return actor.type === "character" && actor.hasPlayerOwner;
}

/**
 * Aktorzy, którymi bieżący użytkownik może ZARZĄDZAĆ (dodawać/wykonywać):
 * karty graczy, których jest właścicielem (GM = wszystkie, gracz = własna).
 */
export function getManageableActors() {
  return game.actors.filter((a) => isPlayerCharacter(a) && a.isOwner);
}

/**
 * Wiersze siatki: WSZYSTKIE karty graczy widoczne dla użytkownika — także te bez
 * zajęć (żeby było widać, kto jeszcze nic nie zaplanował). GM widzi całą drużynę.
 * Sortowane alfabetycznie, własne postaci na górze.
 */
export function getRosterActors() {
  const isGM = game.user.isGM;
  return game.actors
    .filter(
      (a) => isPlayerCharacter(a) && (isGM || a.isOwner || a.testUserPermission(game.user, "LIMITED"))
    )
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Grupy rosteru wg folderu aktora (zakładka Aktorzy): [{ key, name, color, actors }].
 * key = id folderu lub "none"; name = ścieżka „Rodzic / Folder". Kolejność: grupy z własną
 * postacią najpierw, potem alfabetycznie, „Bez folderu" na końcu. W grupie zostaje kolejność wejścia.
 */
export function groupRoster(actors) {
  const groups = new Map();
  for (const actor of actors) {
    const folder = actor.folder ?? null;
    const key = folder?.id ?? "none";
    if (!groups.has(key)) {
      const path = folder ? [...(folder.ancestors ?? [])].reverse().map((f) => f.name) : [];
      groups.set(key, {
        key,
        name: folder ? [...path, folder.name].join(" / ") : t("WDT.Group.NoFolder"),
        color: folder?.color?.css ?? null,
        actors: [],
      });
    }
    groups.get(key).actors.push(actor);
  }
  return [...groups.values()].sort((a, b) => {
    const ao = a.actors.some((x) => x.isOwner);
    const bo = b.actors.some((x) => x.isOwner);
    if (ao !== bo) return ao ? -1 : 1;
    if ((a.key === "none") !== (b.key === "none")) return a.key === "none" ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}
