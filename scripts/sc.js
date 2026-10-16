/**
 * Cienki wrapper na Simple Calendar API z fallbackiem na game.time.worldTime.
 *
 * Cały moduł odwołuje się do czasu wyłącznie przez te funkcje, dzięki czemu
 * działa zarówno z Simple Calendar (oryginał / Reborn / compat-bridge — wszystkie
 * udostępniają to samo globalne SimpleCalendar.api), jak i bez niego.
 */

import { t } from "./const.js";

const SECONDS_PER_DAY = 86400;

/** Czy dostępne jest API Simple Calendar? */
export function hasSimpleCalendar() {
  return !!globalThis.SimpleCalendar?.api;
}

/** Bieżący timestamp świata (sekundy). */
export function getCurrentTimestamp() {
  // Simple Calendar synchronizuje game.time.worldTime, więc to jest pewne źródło.
  // Jeśli SC udostępnia api.timestamp(), preferujemy je (ten sam wynik).
  const api = globalThis.SimpleCalendar?.api;
  if (api && typeof api.timestamp === "function") {
    try {
      const ts = api.timestamp();
      if (Number.isFinite(ts)) return ts;
    } catch (e) {
      /* fallback poniżej */
    }
  }
  return game.time?.worldTime ?? 0;
}

/** Timestamp (sekundy) -> indeks dnia (liczba całkowita, monotoniczna). */
export function timestampToDayIndex(ts) {
  return Math.floor((Number(ts) || 0) / SECONDS_PER_DAY);
}

/** Indeks dnia -> reprezentatywny timestamp (początek dnia). */
export function dayIndexToTimestamp(dayIndex) {
  return dayIndex * SECONDS_PER_DAY;
}

/** Czytelna etykieta dnia dla danego timestampa. */
export function formatTimestamp(ts) {
  if (hasSimpleCalendar()) {
    try {
      const d = SimpleCalendar.api.timestampToDate(ts);
      const disp = d?.display ?? {};
      const weekday = disp.weekday ? `${disp.weekday}, ` : "";
      if (disp.day && disp.monthName) {
        return `${weekday}${disp.day} ${disp.monthName} ${disp.year ?? ""}`.trim();
      }
      if (disp.date) return `${weekday}${disp.date}`.trim();
    } catch (e) {
      /* fallback poniżej */
    }
  }
  return t("WDT.DayN", { n: timestampToDayIndex(ts) });
}

/** Zwięzła data: „dzień miesiąc rok" (bez dnia tygodnia i pory roku). Do etykiet okresu. */
export function formatDateShort(ts) {
  if (hasSimpleCalendar()) {
    try {
      const d = SimpleCalendar.api.timestampToDate(ts);
      const disp = d?.display ?? {};
      const day = disp.day || (Number.isFinite(d?.day) ? d.day + 1 : "");
      const month = (disp.monthName || "").replace(/\s*\(.*?\)\s*/g, "").trim(); // bez pory roku w nawiasie
      const year = disp.year ?? "";
      const s = `${day} ${month} ${year}`.replace(/\s+/g, " ").trim();
      if (s) return s;
    } catch (e) {
      /* fallback poniżej */
    }
  }
  return t("WDT.DayN", { n: timestampToDayIndex(ts) });
}

/**
 * Zwięzłe części daty do nagłówka kolumny: { num, sub, full }.
 *  - num  = numer dnia (np. "28"),
 *  - sub  = krótki podpis (miesiąc; pora roku w nawiasie usuwana),
 *  - full = pełny, ozdobny string do tooltipa / paska bieżącej daty.
 *
 * Uwaga: dni interkalarne (np. „Dzień Podatków") mają puste display.day/monthName —
 * wtedy num pochodzi z d.day+1, a sub z oczyszczonej pełnej daty.
 */
export function formatDayParts(ts) {
  if (hasSimpleCalendar()) {
    try {
      const d = SimpleCalendar.api.timestampToDate(ts);
      const disp = d?.display ?? {};
      const stripParen = (s) => (s || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
      const full = (disp.date && disp.date.trim()) || `${disp.day ?? ""} ${disp.monthName ?? ""} ${disp.year ?? ""}`.trim();
      const num = String(disp.day || (Number.isFinite(d?.day) ? d.day + 1 : "") || "");
      let sub = stripParen(disp.monthName) || stripParen(disp.weekday);
      if (!sub) sub = stripParen(full).replace(/\d+/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
      return { num, sub, full };
    } catch (e) {
      /* fallback poniżej */
    }
  }
  const day = timestampToDayIndex(ts);
  return { num: String(day), sub: t("WDT.Day"), full: t("WDT.DayN", { n: day }) };
}

/**
 * Informacje o tygodniu kalendarza dla danego timestampa.
 * Zwraca { weekdayIndex, weekLength } z Simple Calendar (np. 8-dniowy tydzień WFRP)
 * albo null, gdy SC niedostępny / brak danych.
 */
export function getWeekInfo(ts) {
  if (!hasSimpleCalendar()) return null;
  try {
    const api = SimpleCalendar.api;
    const weekdays = api.getAllWeekdays?.() ?? [];
    const len = weekdays.length;
    const d = api.timestampToDate(ts);
    const idx = Number(d?.dayOfTheWeek);
    if (len > 0 && Number.isFinite(idx)) return { weekdayIndex: idx, weekLength: len };
  } catch (e) {
    /* fallback poniżej */
  }
  return null;
}

/**
 * Notatki / święta z Simple Calendar dla dnia danego timestampa (read-only).
 * Zwraca tablicę obiektów { title }.
 */
export function getNotesForTimestamp(ts) {
  if (!hasSimpleCalendar()) return [];
  try {
    const d = SimpleCalendar.api.timestampToDate(ts);
    const notes = SimpleCalendar.api.getNotesForDay(d.year, d.month, d.day) ?? [];
    return notes.map((n) => ({ title: n?.name ?? n?.title ?? "" })).filter((n) => n.title);
  } catch (e) {
    return [];
  }
}

/**
 * Rejestruje callback na zmianę daty/czasu (Simple Calendar lub rdzeniowy updateWorldTime).
 * Zwraca funkcję wyrejestrowującą.
 */
export function onTimeChange(callback) {
  const handlers = [];
  if (globalThis.SimpleCalendar?.Hooks?.DateTimeChange) {
    const id = Hooks.on(SimpleCalendar.Hooks.DateTimeChange, callback);
    handlers.push(() => Hooks.off(SimpleCalendar.Hooks.DateTimeChange, id));
  }
  const coreId = Hooks.on("updateWorldTime", callback);
  handlers.push(() => Hooks.off("updateWorldTime", coreId));
  return () => handlers.forEach((off) => off());
}
