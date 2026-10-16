/**
 * TimelineApp — siatka gracze × dni (ApplicationV2 + Handlebars).
 * Widok tygodnia (dziś po prawej), nawigacja strzałkami (tydzień/miesiąc),
 * skróty „zrób teraz" oraz tryb planowania (malowanie wielu dni + jeden zbiorczy rzut).
 */

import { MODULE_ID, DEFAULT_DAYS_TO_SHOW, ENDEAVOURS, ACTIVITY_TYPES, t } from "./const.js";
import {
  getCurrentTimestamp,
  timestampToDayIndex,
  dayIndexToTimestamp,
  formatDayParts,
  getNotesForTimestamp,
  getWeekInfo,
  hasSimpleCalendar,
} from "./sc.js";
import {
  getActivities,
  setActivities,
  getRosterActors,
  groupRoster,
  addActivity,
  removeActivity,
  getActivity,
  updateActivity,
  getStandingOffset,
  setStandingOffset,
} from "./activities.js";
import {
  executeActivity,
  createExtendedTest,
  batchResolve,
  dayCostBpOn,
  costModifierFor,
  setDayModifiers,
  effectiveStatus,
  ladderIndex,
} from "./templates.js";
import { moneyText } from "./money.js";
import { pickTestTarget, pickExtendedTarget, promptNote, promptAilments, promptEditNote } from "./activity-dialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Typy dostępne w trybie planowania (batch) — kolejność jak w trybie standardowym (bez testu/odpoczynku). */
const PLAN_TYPES = ["extended", "income", "adventure", "healing"];

/** Ikona typu zajęcia (na kompaktowej karcie). */
const TYPE_ICON = {
  test: "fa-dice-d20",
  extended: "fa-hourglass-half",
  income: "fa-coins",
  adventure: "fa-person-hiking",
  healing: "fa-staff-snake",
  rest: "fa-bed",
};

/** Nazwa celu rzutu do wyświetlenia (cecha → etykieta). */
function targetLabel(roll) {
  if (!roll?.value) return "";
  if (roll.kind === "char") return game.wfrp4e?.config?.characteristics?.[roll.value] ?? roll.value;
  return roll.value;
}

/** Wzbogaca surowe zajęcie o pola widoku (dla "extended" czyta SL żywcem z karty). */
function enrich(a, actor) {
  const lastLog = a.log?.length ? a.log[a.log.length - 1] : null;
  const sl = Number.isFinite(lastLog?.sl) ? lastLog.sl : null;
  const roll = Number.isFinite(lastLog?.roll) && lastLog.roll > 0 ? lastLog.roll : null;
  const psStr = sl != null ? `${sl >= 0 ? "+" : ""}${sl} ${t("WDT.SL")}` : "";

  const e = {
    ...a,
    typeLabel: t(`WDT.Type.${a.type}`),
    isDone: a.status === "done",
    isExtended: a.type === "extended",
    isIncome: a.type === "income",
    icon: TYPE_ICON[a.type] ?? "fa-dice-d20",
    note: a.note ?? "",
    hasNote: a.type === "adventure" || a.type === "healing", // notatka edytowalna po rozwinięciu
    sl, // PS tego dnia (do sumy w połączonej komórce)
    lastLog,
  };

  // Cel rzutu (zapisany przy rozliczeniu) — pokazywany TYLKO w szczegółach.
  const target = Number.isFinite(lastLog?.target) && lastLog.target > 0 ? lastLog.target : null;
  // Kompakt: „20 +3 PS"; szczegóły: „20 na 50 +3 PS".
  const rollPs = (roll != null ? `${roll} ${psStr}` : psStr).trim();
  const rollPsTarget = (roll != null && target != null ? `${roll} ${t("WDT.Roll.Vs")} ${target} ${psStr}` : rollPs).trim();

  // Nazwa (kompakt) + wynik (kompakt) + wynik rozwinięty + szczegóły (detail) per typ.
  let name = "";
  let result = "";
  let resultExpanded = "";
  let detail = "";
  if (a.type === "test") {
    name = targetLabel(a.roll);
    result = rollPs;
    resultExpanded = rollPsTarget;
    detail = t("WDT.Type.test"); // pod nazwą umiejętności: „Test"
  } else if (a.type === "extended") {
    const item = actor.items.get(a.extendedTestId);
    const cur = item?.system.SL?.current ?? 0;
    const tgt = item?.system.SL?.target ?? 1;
    e.extName = item?.name ?? t("WDT.ExtendedMissingShort");
    e.missing = !item;
    e.SL = { current: cur, target: tgt };
    e.slPct = Math.min(100, Math.max(0, Math.round((cur / tgt) * 100)));
    e.showSlBar = !a.extDay; // dzienne karty batcha nie pokazują paska całości
    if (a.extDay) e.isDone = a.status === "done";
    else if (!e.missing && cur >= tgt) e.isDone = true;
    name = e.extName;
    result = rollPs;
    resultExpanded = rollPsTarget;
    const underlying = item?.system.test?.value; // gotowa nazwa umiejętności / etykieta cechy
    detail = underlying ? `${t("WDT.Type.extended")} · ${underlying}` : t("WDT.Type.extended");
  } else if (a.type === "income") {
    name = t("WDT.Type.income"); // „Dochód"
    result = lastLog?.payout || "";
    resultExpanded = result;
    detail = a.label || ""; // nazwa umiejętności zarobkowej (po rozliczeniu)
  } else if (a.type === "adventure") {
    name = t("WDT.Type.adventure"); // ZAWSZE „Przygoda"
    detail = (a.note || "").trim(); // notatka tylko w szczegółach
  } else if (a.type === "healing") {
    name = t("WDT.Type.healing"); // „Leczenie"
    const who = (a.note || "").trim();
    detail = [who, t("WDT.Healing.Ailments", { n: Number(a.ailments) || 0 })].filter(Boolean).join(" · ");
  } else if (a.type === "rest") {
    name = t("WDT.Type.rest");
    result = rollPs;
    resultExpanded = rollPsTarget;
  }
  e.name = name;
  e.result = result;
  e.resultExpanded = resultExpanded || result;
  e.detail = detail;

  return e;
}

export class TimelineApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #offset = 0; // przesunięcie okna w dniach (0 = bieżący tydzień)
  #planMode = false;
  #planType = "extended";
  #selection = new Set(); // klucze "<actorId>::<dayIndex>"
  #expanded = null; // Set<actorId> rozwiniętych wierszy (lazy init)
  #modMode = false; // tryb modyfikatorów kosztu (MG)
  #modSelection = new Set(); // Set<dayIndex>
  #modFactor = 1; // mnożnik w pasku modyfikatorów (×1 = neutralnie / usuń)
  #modNote = ""; // powód modyfikatora
  #weekMode = false; // tryb „Zaznacz tydzień": klik = tydzień danego wiersza
  #view = null; // { collapsed: Set<groupKey>, hidden: Set<actorId> } — lazy z ustawienia "rosterView"
  #showHidden = false; // pokaż schowane postacie (przyciemnione) — tylko stan okna

  static DEFAULT_OPTIONS = {
    id: "wdt-timeline",
    classes: ["wdt", "wdt-timeline-app"],
    tag: "div",
    window: { title: "WDT.Title", icon: "fa-solid fa-calendar-days", resizable: true },
    position: { width: 1100, height: 640 },
    actions: {
      quickTest: TimelineApp.#onQuickTest,
      quickExtended: TimelineApp.#onQuickExtended,
      quickIncome: TimelineApp.#onQuickIncome,
      quickAdventure: TimelineApp.#onQuickAdventure,
      quickHealing: TimelineApp.#onQuickHealing,
      quickRest: TimelineApp.#onQuickRest,
      deleteActivity: TimelineApp.#onDelete,
      editNote: TimelineApp.#onEditNote,
      prevWeek: TimelineApp.#onPrevWeek,
      nextWeek: TimelineApp.#onNextWeek,
      gotoToday: TimelineApp.#onToday,
      togglePlan: TimelineApp.#onTogglePlan,
      setPlanType: TimelineApp.#onSetPlanType,
      runPlan: TimelineApp.#onRunPlan,
      clearPlan: TimelineApp.#onClearPlan,
      clearDays: TimelineApp.#onClearDays,
      toggleWeekMode: TimelineApp.#onToggleWeekMode,
      toggleActor: TimelineApp.#onToggleActor,
      resetStanding: TimelineApp.#onResetStanding,
      toggleMod: TimelineApp.#onToggleMod,
      applyMod: TimelineApp.#onApplyMod,
      modFactorStep: TimelineApp.#onModFactorStep,
      openSheet: TimelineApp.#onOpenSheet,
      toggleGroup: TimelineApp.#onToggleGroup,
      toggleHidden: TimelineApp.#onToggleHidden,
      toggleShowHidden: TimelineApp.#onToggleShowHidden,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/timeline.hbs`, scrollable: [".wdt-grid-scroll"] },
  };

  get daysToShow() {
    return Number(game.settings.get(MODULE_ID, "daysToShow")) || DEFAULT_DAYS_TO_SHOW;
  }

  /** Widok rosteru (zwinięte grupy / schowane postacie) — lokalna kopia ustawienia per użytkownik. */
  #getView() {
    if (!this.#view) {
      let raw = {};
      try {
        raw = game.settings.get(MODULE_ID, "rosterView") ?? {};
      } catch (e) {
        /* brak ustawienia → pusty widok */
      }
      const ids = (v) => new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
      this.#view = { collapsed: ids(raw.collapsed), hidden: ids(raw.hidden) };
    }
    return this.#view;
  }

  /** Zapis widoku rosteru (po renderze — okno reaguje od razu, serwer dostaje zmianę w tle). */
  async #saveView() {
    const v = this.#getView();
    try {
      await game.settings.set(MODULE_ID, "rosterView", { collapsed: [...v.collapsed], hidden: [...v.hidden] });
    } catch (e) {
      console.warn(`${MODULE_ID} | nie udało się zapisać widoku rosteru`, e);
    }
  }

  async _prepareContext() {
    const nowTs = getCurrentTimestamp();
    const baseDay = timestampToDayIndex(nowTs);
    // Widok = kalendarzowy tydzień z Simple Calendar (wyrównany od 1. do ostatniego dnia).
    // #offset liczony w TYGODNIACH. Bez SC: fallback do okna daysToShow kończącego się na dziś.
    const wk = getWeekInfo(nowTs);
    let n, start;
    if (wk) {
      n = wk.weekLength;
      start = baseDay - wk.weekdayIndex + this.#offset * n;
    } else {
      n = this.daysToShow;
      start = baseDay - (n - 1) + this.#offset * n;
    }

    const isGM = game.user.isGM;
    const doubleFirst = game.settings.get(MODULE_ID, "doubleIncomeFirstDay");
    const showCostGlobal = game.settings.get(MODULE_ID, "postCostOfLiving");
    const merge = game.settings.get(MODULE_ID, "mergeAdjacent") && !this.#planMode && !this.#modMode;

    const roster = getRosterActors();
    // Domyślne rozwinięcie: własna postać gracza; gracz bez przypisanej → własne; MG → puste.
    if (this.#expanded === null) {
      const ch = game.user.character;
      if (ch) this.#expanded = new Set([ch.id]);
      else if (!isGM) this.#expanded = new Set(roster.filter((a) => a.isOwner).map((a) => a.id));
      else this.#expanded = new Set();
    }

    const days = [];
    for (let i = 0; i < n; i++) {
      const dayIndex = start + i;
      const ts = dayIndexToTimestamp(dayIndex);
      const parts = formatDayParts(ts);
      const mod = costModifierFor(dayIndex);
      const modFactor = mod.factor !== 1 ? String(mod.factor).replace(".", ",") : null;
      days.push({
        dayIndex,
        timestamp: ts,
        num: parts.num,
        sub: parts.sub,
        full: parts.full,
        isToday: dayIndex === baseDay,
        notes: getNotesForTimestamp(ts),
        modFactor,
        modTitle: modFactor ? `×${modFactor}${mod.note ? " — " + mod.note : ""}` : "",
        isWorkday: doubleFirst && getWeekInfo(ts)?.weekdayIndex === 0,
        modSelected: this.#modSelection.has(dayIndex),
      });
    }

    const view = this.#getView();
    const rowFor = (actor) => {
      const acts = getActivities(actor);
      const off = getStandingOffset(actor);
      const eff = effectiveStatus(actor);
      const tierLabel = t(`WDT.Tier.${eff.tier}`);
      const status = {
        eff: eff.standing,
        tierLabel,
        full: `${tierLabel} ${eff.standing}`,
        up: off > 0,
        down: off < 0,
        changed: off !== 0,
      };
      const expanded = this.#expanded.has(actor.id);
      const cells = days.map((day) => {
        const dayActs = acts
          .filter((a) => timestampToDayIndex(a.timestamp) === day.dayIndex)
          .map((a) => enrich(a, actor));
        // Pokazujemy tylko ZREALIZOWANE (niezrealizowane karty rzutów znikają).
        const realizing = dayActs.filter((a) => ENDEAVOURS[a.type]?.realizes && a.status === "done");
        const heal = realizing.find((a) => a.type === "healing");
        // Chip kosztu = ZAMROŻONA suma OPŁACONYCH zajęć (pojawia się dopiero po zapłacie).
        let cost = null;
        let costBp = 0;
        let costTitle = t("WDT.Cost.Upkeep");
        if (showCostGlobal) {
          const paidActs = realizing.filter((a) => a.paid && Number(a.costBp) > 0);
          if (paidActs.length) {
            costBp = paidActs.reduce((s, a) => s + Number(a.costBp), 0);
          } else if (realizing.some((a) => a.paid === undefined) && realizing.some((a) => a.upkeep !== false)) {
            // Legacy (wpisy sprzed v2.1 bez paid/costBp): policz na żywo, żeby koszt nie zniknął.
            costBp = dayCostBpOn(actor, day.dayIndex, { healing: !!heal, ailments: Number(heal?.ailments) || 0 });
          }
          if (costBp > 0) {
            cost = moneyText(costBp, actor);
            costTitle = heal ? t("WDT.Cost.Healing", { n: Number(heal?.ailments) || 0 }) : t("WDT.Cost.Upkeep");
          }
        }
        return {
          timestamp: day.timestamp,
          dayIndex: day.dayIndex,
          isToday: day.isToday,
          canEdit: actor.isOwner,
          selected: this.#selection.has(`${actor.id}::${day.dayIndex}`),
          // Skróty „zrób teraz": gdy rozwinięty LUB brak czynności realizującej (odpoczynek się nie liczy).
          showQuick: actor.isOwner && !this.#planMode && !this.#modMode && (expanded || realizing.length === 0),
          activities: realizing,
          rest: dayActs.filter((a) => !ENDEAVOURS[a.type]?.realizes && a.status === "done"),
          cost,
          costBp,
          costTitle,
        };
      });
      // Łączenie tylko w widoku ZWINIĘTYM (rozwinięty pokazuje dni osobno, ze szczegółami i „X").
      if (merge && !expanded) this.#applyMerge(cells, days, actor);
      return {
        actorId: actor.id,
        actorName: actor.name,
        img: actor.img,
        canEdit: actor.isOwner,
        expanded,
        hidden: view.hidden.has(actor.id),
        status,
        cells,
      };
    };

    // Grupy = foldery aktorów; wiersze budujemy tylko dla rozwiniętych grup, bez schowanych postaci.
    const visibleIds = new Set();
    const groups = groupRoster(roster).map((g) => {
      const collapsed = view.collapsed.has(g.key);
      const shown = collapsed ? [] : g.actors.filter((a) => this.#showHidden || !view.hidden.has(a.id));
      for (const a of shown) visibleIds.add(a.id);
      return {
        key: g.key,
        name: g.name,
        color: g.color,
        count: g.actors.length,
        hiddenCount: g.actors.filter((a) => view.hidden.has(a.id)).length,
        collapsed,
        rows: shown.map(rowFor),
      };
    });
    const showGroups = roster.some((a) => !!a.folder);
    const hiddenTotal = roster.filter((a) => view.hidden.has(a.id)).length;
    // Zaznaczenie planu tylko na widocznych wierszach (schowane/zwinięte nie wchodzą do „Wykonaj plan").
    for (const key of [...this.#selection]) {
      if (!visibleIds.has(key.split("::")[0])) this.#selection.delete(key);
    }

    const first = days[0];
    const last = days[days.length - 1];
    return {
      days,
      groups,
      showGroups,
      hasRows: roster.length > 0,
      allHidden: !showGroups && visibleIds.size === 0,
      hiddenTotal,
      showHidden: this.#showHidden,
      daysCount: days.length,
      hasSC: hasSimpleCalendar(),
      isGM,
      currentLabel: `${first.num} ${first.sub} – ${last.num} ${last.sub}`,
      planMode: this.#planMode,
      modMode: this.#modMode,
      weekMode: this.#weekMode,
      modFactor: this.#modFactor,
      modNote: this.#modNote,
      planTypes: PLAN_TYPES.map((v) => ({ value: v, label: t(`WDT.Type.${v}`), active: v === this.#planType })),
    };
  }

  /**
   * Łączenie sąsiednich identycznych dni (typ+nazwa+koszt) w JEDNĄ szerszą komórkę (grid-column span).
   * Tylko widok; dane/koszt/kasowanie zostają per dzień. Start grupy dostaje `span` + `mergeRange`,
   * pozostałe komórki grupy → `hidden` (nie renderowane).
   */
  #applyMerge(cells, days, actor) {
    const keyOf = (c) => {
      if (c.hidden || c.activities.length !== 1) return null;
      const a = c.activities[0];
      if (a.type === "test") return null; // proste testy nie łączymy (różne wyniki)
      return `${a.type}|${a.name}|${c.costBp}`;
    };
    let i = 0;
    while (i < cells.length) {
      const k = keyOf(cells[i]);
      if (!k) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < cells.length && keyOf(cells[j + 1]) === k) j++;
      if (j > i) {
        const span = j - i + 1;
        cells[i].span = span;
        cells[i].mergeRange = t("WDT.Days", { n: span }); // liczba dni zamiast zakresu (daty są w nagłówkach)
        for (let x = i + 1; x <= j; x++) cells[x].hidden = true;
        // Agregat wyniku na karcie startowej (jak podsumowanie na czacie).
        const a0 = cells[i].activities[0];
        const group = [];
        for (let x = i; x <= j; x++) group.push(cells[x].activities[0]);
        if (a0.type === "income") {
          const sum = group.reduce((s, a) => s + (Number(a.earnedBp) || 0), 0);
          if (sum > 0) a0.result = moneyText(sum, actor);
        } else if (a0.type === "extended") {
          const sum = group.reduce((s, a) => s + (Number.isFinite(a.sl) ? a.sl : 0), 0);
          a0.result = `${sum >= 0 ? "+" : ""}${sum} ${t("WDT.SL")}`;
        }
      }
      i = j + 1;
    }
  }

  /** Po renderze: malowanie (plan/modyfikatory) + sterowanie statusem. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.#planMode) this.#wirePainting();
    else if (this.#modMode) {
      this.#wireModPainting();
      this.#wireModInputs();
    }
    this.#wireStatus();
  }

  /** Utrwala wpis pól modbara („Powód"/mnożnik) na bieżąco, żeby ponowny render ich nie czyścił. */
  #wireModInputs() {
    const root = this.element;
    if (!root) return;
    const note = root.querySelector('[name="wdt-mod-note"]');
    if (note) note.addEventListener("input", () => (this.#modNote = note.value));
    const fac = root.querySelector('[name="wdt-mod-factor"]');
    if (fac)
      fac.addEventListener("input", () => {
        const v = Number(fac.value);
        if (Number.isFinite(v) && v >= 0) this.#modFactor = v;
      });
  }

  /** Malowanie nagłówków dni (tryb modyfikatorów MG). */
  #wireModPainting() {
    const grid = this.element?.querySelector(".wdt-grid");
    if (!grid) return;
    let painting = false;
    let addMode = true;
    const idxOf = (h) => Number(h.dataset.dayIndex);
    const apply = (h, add) => {
      const idx = idxOf(h);
      if (!Number.isFinite(idx)) return;
      if (add) {
        this.#modSelection.add(idx);
        h.classList.add("wdt-selected");
      } else {
        this.#modSelection.delete(idx);
        h.classList.remove("wdt-selected");
      }
    };
    grid.addEventListener("pointerdown", (ev) => {
      const h = ev.target.closest(".wdt-day-head[data-day-index]");
      if (!h) return;
      ev.preventDefault();
      painting = true;
      addMode = !this.#modSelection.has(idxOf(h));
      apply(h, addMode);
    });
    grid.addEventListener("pointerover", (ev) => {
      if (!painting) return;
      const h = ev.target.closest(".wdt-day-head[data-day-index]");
      if (h) apply(h, addMode);
    });
    const stop = () => (painting = false);
    grid.addEventListener("pointerup", stop);
    grid.addEventListener("pointerleave", stop);
  }

  /** Sterowanie „Status" pod postacią (lewy klik = +1, prawy = −1, pole = pełny wpis „Srebro 5"). */
  #wireStatus() {
    const root = this.element;
    if (!root) return;
    const baseIdxOf = (actor) => {
      const s = actor.system?.details?.status ?? {};
      return ladderIndex(s.tier, s.standing);
    };
    // Bez limitu ±1 — tylko granice drabiny (0..14). Offset = cel − baza.
    const apply = async (actor, targetIdx) => {
      const clamped = Math.max(0, Math.min(14, targetIdx));
      await setStandingOffset(actor, clamped - baseIdxOf(actor));
      this.render();
    };
    // Mapa zlokalizowanych nazw tierów → litera (do parsowania pełnego statusu).
    const tierByName = {};
    for (const k of ["b", "s", "g"]) tierByName[t(`WDT.Tier.${k}`).toLowerCase()] = k;

    root.querySelectorAll(".wdt-status-label").forEach((el) => {
      const actor = game.actors.get(el.dataset.actorId);
      if (!actor?.isOwner) return;
      const cur = () => baseIdxOf(actor) + getStandingOffset(actor);
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        apply(actor, cur() + 1);
      });
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        apply(actor, cur() - 1);
      });
    });
    root.querySelectorAll(".wdt-status-input").forEach((el) => {
      const actor = game.actors.get(el.dataset.actorId);
      if (!actor?.isOwner) return;
      el.addEventListener("click", (ev) => ev.stopPropagation()); // edycja nie rozwija wiersza
      el.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const s = String(el.value).trim().toLowerCase();
        const num = parseInt((s.match(/\d+/) || [])[0] ?? "", 10);
        let tier = null;
        for (const name in tierByName) if (name && s.includes(name)) tier = tierByName[name];
        const eff = effectiveStatus(actor);
        const standing = Number.isFinite(num) ? num : eff.standing;
        apply(actor, ladderIndex(tier ?? eff.tier, standing));
      });
    });
  }

  /* --- malowanie zaznaczenia (tryb planowania) ----------------------- */

  /** Tryb „Zaznacz tydzień": klik w komórkę przełącza WOLNE dni widocznego tygodnia danego wiersza. */
  #wireWeekSelect(grid) {
    const days = this.#visibleDayIndexes();
    grid.addEventListener("pointerdown", (ev) => {
      const cell = ev.target.closest(".wdt-cell[data-actor-id]");
      if (!cell) return;
      ev.preventDefault();
      const actor = game.actors.get(cell.dataset.actorId);
      if (!actor?.isOwner) return;
      // Klik w WOLNY dzień → zaznacz wolne (do „Wykonaj plan"); klik w ZAJĘTY → zaznacz zajęte (do „Usuń zajęcia").
      const wantOccupied = this.#dayHasRealizing(actor, Number(cell.dataset.dayIndex));
      const keys = days
        .filter((d) => this.#dayHasRealizing(actor, d) === wantOccupied)
        .map((d) => `${actor.id}::${d}`);
      if (!keys.length) return;
      const allSel = keys.every((kk) => this.#selection.has(kk));
      for (const kk of keys) (allSel ? this.#selection.delete(kk) : this.#selection.add(kk));
      this.render();
    });
  }

  #wirePainting() {
    const root = this.element;
    const grid = root?.querySelector(".wdt-grid");
    if (!grid) return;
    if (this.#weekMode) return this.#wireWeekSelect(grid); // klik = cały tydzień wiersza

    let painting = false;
    let addMode = true;
    const keyOf = (cell) => `${cell.dataset.actorId}::${cell.dataset.dayIndex}`;
    const apply = (cell, add) => {
      const key = keyOf(cell);
      if (add) {
        this.#selection.add(key);
        cell.classList.add("wdt-selected");
      } else {
        this.#selection.delete(key);
        cell.classList.remove("wdt-selected");
      }
    };

    grid.addEventListener("pointerdown", (ev) => {
      const cell = ev.target.closest(".wdt-cell.wdt-paintable");
      if (!cell) return;
      ev.preventDefault();
      painting = true;
      addMode = !this.#selection.has(keyOf(cell));
      apply(cell, addMode);
    });
    grid.addEventListener("pointerover", (ev) => {
      if (!painting) return;
      const cell = ev.target.closest(".wdt-cell.wdt-paintable");
      if (cell) apply(cell, addMode);
    });
    const stop = () => (painting = false);
    grid.addEventListener("pointerup", stop);
    grid.addEventListener("pointerleave", stop);
  }

  /* --- wspólny tor skrótów: utwórz zajęcie → wykonaj → posprzątaj ----- */
  static async #createRun(app, actor, data) {
    const activity = await addActivity(actor, data);
    const ok = await executeActivity(actor, activity);
    if (!ok) await removeActivity(actor, activity.id);
    app.render();
  }

  static #cell(target) {
    return { actor: game.actors.get(target.dataset.actorId), ts: Number(target.dataset.ts) };
  }

  /* --- skróty „zrób teraz" --- */

  static async #onQuickTest(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    const roll = await pickTestTarget(actor);
    if (!roll) return;
    // Bez tytułu — kartę opisuje sama linia z nazwą umiejętności/cechy (jak w wydłużonym).
    await TimelineApp.#createRun(this, actor, { type: "test", timestamp: ts, roll, label: "" });
  }

  static async #onQuickExtended(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    const data = await pickExtendedTarget(actor);
    if (!data) return;
    // Nowy test wydłużony: utwórz i otwórz arkusz konfiguracji (trudność/cel) — bez rzutu.
    // Rzut na dany dzień wykonuje się potem przez ⏳ → wybór istniejącego.
    if (data.newExtended) {
      const item = await createExtendedTest(actor, data.newExtended);
      if (item) item.sheet?.render(true);
      return;
    }
    const extendedTestId = data.extendedTestId ?? null;
    if (!extendedTestId) return;
    // Bez tytułu — kartę opisuje sama linia z nazwą testu (extName).
    await TimelineApp.#createRun(this, actor, { type: "extended", timestamp: ts, extendedTestId, label: "" });
  }

  static async #onQuickIncome(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    await TimelineApp.#createRun(this, actor, { type: "income", timestamp: ts, label: t("WDT.Type.income") });
  }

  static async #onQuickAdventure(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    const res = await promptNote(actor);
    if (!res) return;
    await TimelineApp.#createRun(this, actor, {
      type: "adventure",
      timestamp: ts,
      note: res.note,
      upkeep: res.upkeep,
      label: t("WDT.Type.adventure"),
    });
  }

  static async #onQuickHealing(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    const res = await promptAilments(actor);
    if (!res) return;
    await TimelineApp.#createRun(this, actor, {
      type: "healing",
      timestamp: ts,
      ailments: res.ailments,
      note: res.note,
      label: t("WDT.Type.healing"),
    });
  }

  static async #onQuickRest(event, target) {
    const { actor, ts } = TimelineApp.#cell(target);
    if (!actor) return;
    await TimelineApp.#createRun(this, actor, { type: "rest", timestamp: ts, label: t("WDT.Type.rest") });
  }

  static async #onDelete(event, target) {
    const actor = game.actors.get(target.dataset.actorId);
    const id = target.dataset.activityId;
    if (!actor || !id) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("WDT.Confirm.DeleteTitle") },
      content: `<p>${t("WDT.Confirm.DeleteBody")}</p>`,
    });
    if (!ok) return;
    await removeActivity(actor, id);
    this.render();
  }

  /** Edycja notatki zajęcia (przygoda / „u kogo" leczenia) — okno z tekstem, zapis do activity.note. */
  static async #onEditNote(event, target) {
    const actor = game.actors.get(target?.dataset?.actorId);
    if (!actor?.isOwner) return;
    const id = target?.dataset?.activityId;
    if (!id) return;
    const res = await promptEditNote(getActivity(actor, id)?.note ?? "");
    if (res === null) return; // anulowano
    await updateActivity(actor, id, { note: res });
    this.render();
  }

  /* --- nawigacja (tydzień / miesiąc) --- */

  static #onPrevWeek() {
    this.#offset -= 1; // offset w tygodniach
    this.render();
  }
  static #onNextWeek() {
    this.#offset += 1;
    this.render();
  }
  static #onToday() {
    this.#offset = 0;
    this.render();
  }

  /* --- tryb planowania (batch) --- */

  static #onTogglePlan() {
    this.#planMode = !this.#planMode;
    if (this.#planMode) {
      this.#modMode = false;
      this.#modSelection.clear();
    } else {
      this.#selection.clear();
      this.#weekMode = false;
    }
    this.render();
  }

  static #onSetPlanType(event, target) {
    const type = target?.dataset?.type;
    if (type) this.#planType = type;
    this.render();
  }

  static #onClearPlan() {
    this.#selection.clear();
    this.render();
  }

  static async #onRunPlan() {
    const type = this.#planType; // źródło prawdy: przyciski typu (bez czytania DOM)
    if (!ACTIVITY_TYPES.includes(type)) return;
    if (!this.#selection.size) return ui.notifications.warn(t("WDT.Plan.Empty"));

    let ailments = 0;
    let note = "";
    let upkeep = true;
    // Leczenie i przygoda pytają OKNEM po „Wykonaj plan" (raz dla całego planu).
    if (type === "healing") {
      const res = await promptAilments();
      if (!res) return; // anulowano → przerwij plan
      ailments = res.ailments;
      note = res.note;
    } else if (type === "adventure") {
      const res = await promptNote();
      if (!res) return;
      note = res.note;
      upkeep = res.upkeep;
    }

    const byActor = new Map();
    for (const key of this.#selection) {
      const [actorId, dayIdx] = key.split("::");
      if (!byActor.has(actorId)) byActor.set(actorId, []);
      byActor.get(actorId).push(Number(dayIdx));
    }

    for (const [actorId, dayIdxs] of byActor) {
      const actor = game.actors.get(actorId);
      if (!actor?.isOwner) continue;
      dayIdxs.sort((a, b) => a - b);
      await batchResolve(actor, type, dayIdxs, { ailments, upkeep, note });
    }

    this.#selection.clear();
    this.render();
  }

  /* --- czyszczenie dni / zaznaczanie tygodnia --- */

  /** Indeksy dni aktualnie widocznego tygodnia (jak w _prepareContext). */
  #visibleDayIndexes() {
    const baseDay = timestampToDayIndex(getCurrentTimestamp());
    const wk = getWeekInfo(getCurrentTimestamp());
    let n, start;
    if (wk) {
      n = wk.weekLength;
      start = baseDay - wk.weekdayIndex + this.#offset * n;
    } else {
      n = this.daysToShow;
      start = baseDay - (n - 1) + this.#offset * n;
    }
    return Array.from({ length: n }, (_, i) => start + i);
  }

  /** Czy aktor ma czynność realizującą w danym dniu (do „zaznacz tydzień" / pomijania). */
  #dayHasRealizing(actor, dayIndex) {
    return getActivities(actor).some(
      (a) => ENDEAVOURS[a.type]?.realizes && a.status === "done" && timestampToDayIndex(a.timestamp) === dayIndex
    );
  }

  /** „Wyczyść dni" — usuwa zajęcia tylko z zamalowanych komórek (aktor + dzień). */
  static async #onClearDays() {
    if (!this.#selection.size) return ui.notifications.warn(t("WDT.Plan.Empty"));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("WDT.Plan.ClearDaysTitle") },
      content: `<p>${t("WDT.Plan.ClearDaysBody")}</p>`,
    });
    if (!ok) return;
    const byActor = new Map();
    for (const key of this.#selection) {
      const [actorId, dayIdx] = key.split("::");
      if (!byActor.has(actorId)) byActor.set(actorId, new Set());
      byActor.get(actorId).add(Number(dayIdx));
    }
    for (const [actorId, daySet] of byActor) {
      const actor = game.actors.get(actorId);
      if (!actor?.isOwner) continue;
      const kept = getActivities(actor).filter((a) => !daySet.has(timestampToDayIndex(a.timestamp)));
      await setActivities(actor, kept);
    }
    this.#selection.clear();
    this.render();
  }

  /** „Zaznacz tydzień" jako TRYB: klik w komórkę zaznacza tydzień TEGO wiersza (wolne dni). */
  static #onToggleWeekMode() {
    this.#weekMode = !this.#weekMode;
    this.render();
  }

  /* --- rozwijanie wiersza aktora (klik) --- */

  static #onToggleActor(event, target) {
    if (this.#planMode || this.#modMode) return; // tam klik = malowanie
    const id = target?.dataset?.actorId;
    if (!id) return;
    if (!this.#expanded) this.#expanded = new Set();
    if (this.#expanded.has(id)) this.#expanded.delete(id);
    else this.#expanded.add(id);
    this.render();
  }

  /* --- grupy / chowanie postaci / karta postaci --- */

  /** Klik w portret: otwiera kartę postaci (w każdym trybie; nie rozwija wiersza). */
  static #onOpenSheet(event, target) {
    const actor = game.actors.get(target?.dataset?.actorId);
    actor?.sheet?.render(true);
  }

  /** Zwiń / rozwiń grupę (folder aktorów). */
  static #onToggleGroup(event, target) {
    const key = target?.dataset?.group;
    if (!key) return;
    const { collapsed } = this.#getView();
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    this.render();
    this.#saveView();
  }

  /** Schowaj / pokaż postać na osi (tylko widok tego użytkownika). */
  static #onToggleHidden(event, target) {
    const id = target?.dataset?.actorId;
    if (!id) return;
    const { hidden } = this.#getView();
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    this.render();
    this.#saveView();
  }

  /** Pokaż schowane postacie (przyciemnione, z ikoną „pokaż”). */
  static #onToggleShowHidden() {
    this.#showHidden = !this.#showHidden;
    this.render();
  }

  /** Reset statusu do wartości z karty postaci (offset = 0). */
  static async #onResetStanding(event, target) {
    const actor = game.actors.get(target?.dataset?.actorId);
    if (!actor?.isOwner) return;
    await setStandingOffset(actor, 0);
    this.render();
  }

  /* --- tryb modyfikatorów kosztu (MG) --- */

  static #onToggleMod() {
    if (!game.user.isGM) return;
    this.#modMode = !this.#modMode;
    if (this.#modMode) {
      this.#planMode = false;
      this.#selection.clear();
    }
    this.#modSelection.clear();
    this.render();
  }

  static async #onApplyMod() {
    if (!game.user.isGM) return;
    const root = this.element;
    const factor = Number(root.querySelector('[name="wdt-mod-factor"]')?.value);
    const note = root.querySelector('[name="wdt-mod-note"]')?.value ?? "";
    this.#modFactor = Number.isFinite(factor) && factor >= 0 ? factor : this.#modFactor;
    this.#modNote = note;
    if (!this.#modSelection.size) return ui.notifications.warn(t("WDT.Plan.Empty"));
    await setDayModifiers([...this.#modSelection], this.#modFactor, note);
    this.#modSelection.clear();
    this.render();
  }

  /** +/- mnożnika kosztu (krok 0,5) — bez render(), żeby nie gubić notatki/zaznaczenia dni. */
  static #onModFactorStep(event, target) {
    const delta = Number(target?.dataset?.delta) || 0;
    const input = this.element?.querySelector('[name="wdt-mod-factor"]');
    let v = Number(input?.value);
    if (!Number.isFinite(v)) v = this.#modFactor;
    v = Math.max(0, Math.round((v + delta) * 4) / 4); // ≥0, zaokrąglone do 0,25
    this.#modFactor = v;
    if (input) input.value = String(v);
  }
}

/* --- singleton + helpery otwierania/odświeżania ---------------------- */

let _instance = null;

export function openTimeline() {
  if (!_instance) _instance = new TimelineApp();
  _instance.render(true);
  return _instance;
}

export function refreshTimeline() {
  if (_instance?.rendered) _instance.render();
}
