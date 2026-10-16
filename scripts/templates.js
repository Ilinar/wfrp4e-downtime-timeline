/**
 * Logika przedsięwzięć (endeavour) — wykonanie ręczne ("Wykonaj").
 *
 * Filozofia v0.2: reużywamy natywne mechaniki WFRP4e zamiast pisać własne.
 *  - test     → actor.setupSkill / setupCharacteristic -> test.roll()
 *  - extended → actor.setupExtendedTest(item) — SL liczony natywnie na karcie
 *  - income   → actor.setupSkill(skill, {income, career}) — system rzuca i WYPŁACA kasę
 *               (test-wfrp4e.js: handleIncomeTest -> game.wfrp4e.market.rollIncome)
 */

import { MODULE_ID, ENDEAVOURS, DEFAULT_COST_PER_LEVEL, DEFAULT_HEAL_RULE, DEFAULT_ROLL_MOD_RATE, t } from "./const.js";
import { updateActivity, addActivities, getActivities, setActivities, getStandingOffset } from "./activities.js";
import { getCurrentTimestamp, formatDateShort, dayIndexToTimestamp, timestampToDayIndex, getWeekInfo } from "./sc.js";
import { moneyText, addBpToActor, payBpFromActor, earnedStrToBpExact } from "./money.js";
import { postUpkeepCard } from "./pay-card.js";

/** Czy aktor pochodzi z systemu WFRP4e (ma API testów)? */
export function isWfrpActor(actor) {
  return typeof actor?.setupSkill === "function";
}

/** Odczytuje znormalizowany wynik testu. */
function readResult(test) {
  const r = test?.result ?? {};
  const sl = Math.trunc(Number(r.SL) || 0);
  let success;
  if (r.outcome) success = r.outcome === "success";
  else success = Number(r.roll) <= Number(r.target);
  return { sl, success, outcome: r.outcome ?? (success ? "success" : "failure") };
}

/** Wpis do dziennika rozliczeń. */
function logEntry(summary, sl, payout = null, roll = null, target = null) {
  return { timestamp: getCurrentTimestamp(), summary, sl, payout, roll, target };
}

/**
 * Punkt wejścia: rozlicz zajęcie mechanicznie.
 * Zwraca true, jeśli zapisano wynik; false gdy przerwano (brak danych / anulowano).
 */
export async function executeActivity(actor, activity) {
  if (!isWfrpActor(actor)) {
    ui.notifications.error(t("WDT.NotWFRP"));
    return false;
  }
  let ok = false;
  switch (activity.type) {
    case "test":
      ok = await execTest(actor, activity);
      break;
    case "extended":
      ok = await execExtended(actor, activity);
      break;
    case "income":
      ok = await execIncome(actor, activity);
      break;
    case "adventure":
      ok = await execAdventure(actor, activity);
      break;
    case "healing":
      ok = await execHealing(actor, activity);
      break;
    case "rest":
      ok = await execRest(actor, activity);
      break;
    default:
      ui.notifications.warn(`WDT | nieznany typ zajęcia: ${activity.type}`);
      return false;
  }
  // Koszt utrzymania tylko dla czynności realizujących dzień (nie dla odpoczynku);
  // przygoda może go wyłączyć (upkeep === false).
  if (ok && ENDEAVOURS[activity.type]?.realizes && activity.upkeep !== false) {
    await chargeSingleUpkeep(actor, activity);
  }
  return ok;
}

/** Zwykły test umiejętności lub cechy. */
async function execTest(actor, activity) {
  const roll = activity.roll ?? { kind: "skill", value: "" };
  if (!roll.value) {
    ui.notifications.warn(t("WDT.NoSkill"));
    return false;
  }
  const ctx = { appendTitle: ` – ${activity.label || t("WDT.Type.test")}`, fields: { modifier: statusRollModifier(actor) } };
  const test = roll.kind === "char" ? await actor.setupCharacteristic(roll.value, ctx) : await actor.setupSkill(roll.value, ctx);
  if (!test) return false;
  await test.roll();
  const { sl, success } = readResult(test);
  const summary = success ? t("WDT.Success") : t("WDT.Failed");
  await updateActivity(actor, activity.id, {
    status: "done",
    log: [...activity.log, logEntry(summary, sl, null, Number(test.result?.roll) || null, Number(test.result?.target) || null)],
  });
  return true;
}

/** Test wydłużony — natywny item z karty; SL kumulowany przez system. */
async function execExtended(actor, activity) {
  const item = actor.items.get(activity.extendedTestId);
  if (!item) {
    ui.notifications.warn(t("WDT.ExtendedMissing"));
    return false;
  }
  if ((item.system.SL?.target ?? 0) <= 0) {
    ui.notifications.warn(t("WDT.ExtendedMissing"));
    return false;
  }
  const before = item.system.SL?.current ?? 0;
  // Kontekst jak natywny setupExtendedTest (okno wczytuje trudność itd.), ale przechwytujemy
  // `test`, by mieć surowy rzut na kartę. `extended: uuid` sprawia, że SL itemu aktualizuje się natywnie.
  const value = item.system.test?.value;
  const charKey = charKeyFor(value);
  const defaultRollMode = item.system.hide?.test || item.system.hide?.progress ? "gmroll" : "roll";
  const ctx = {
    extended: item.uuid,
    hitLocation: false,
    fields: { difficulty: item.system.difficulty?.value || "challenging", rollMode: defaultRollMode, modifier: statusRollModifier(actor) },
    appendTitle: ` – ${item.name}`,
  };
  const test = charKey ? await actor.setupCharacteristic(charKey, ctx) : await actor.setupSkill(value, ctx);
  if (!test) return false;
  await test.roll();

  const target = Math.max(1, item.system.SL?.target ?? 1);
  // PS tego dnia = REALNY przyrost SL itemu (delta), który zastosował natywny handleExtendedTest
  // (honoruje talenty/failingDecreases/negativePossible) — NIE surowy test.result.SL.
  // Guard na brak itemu (completion="remove" nieużywane) — wtedy 0 wkładu, nic nie wybucha.
  const freshItem = actor.items.get(activity.extendedTestId);
  const after = freshItem ? (freshItem.system.SL?.current ?? before) : before;
  const gained = Math.trunc(after - before);
  // Dzień zrealizowany po rzucie (jak w batchu): „done" + wynik tego dnia (przyrost PS).
  await updateActivity(actor, activity.id, {
    status: "done",
    extDay: true,
    log: [
      ...activity.log,
      logEntry(
        `${gained >= 0 ? "+" : ""}${gained} ${t("WDT.SL")}`,
        gained,
        null,
        Number(test.result?.roll) || null,
        Number(test.result?.target) || null
      ),
    ],
  });
  if (after >= target) ui.notifications.info(t("WDT.ExtendedDone", { name: item.name }));
  return true;
}

/**
 * Opcje income (status) z houserule „pierwszy dzień tygodnia → 2× standing".
 * Przy podwojeniu przekazujemy minimalny {standing, tier} (handleIncomeTest używa tylko tych pól);
 * bez podwojenia — oryginalny obiekt statusu (zero regresji).
 */
function incomeOptionFor(actor, ts) {
  const status = actor.system?.details?.status ?? {};
  const doubled =
    game.settings.get(MODULE_ID, "doubleIncomeFirstDay") && getWeekInfo(ts)?.weekdayIndex === 0;
  if (!doubled) return { income: status, doubled: false };
  return { income: { standing: (Number(status.standing) || 1) * 2, tier: status.tier }, doubled: true };
}

/** Zarobek — natywny: umiejętności z aktualnej kariery, wypłata wg statusu. */
async function execIncome(actor, activity) {
  const career = actor.itemTypes.career?.find((c) => c.system.current?.value);
  if (!career) {
    ui.notifications.warn(t("WDT.Income.NoCareer"));
    return false;
  }
  const skills = (career.system.incomeSkill ?? [])
    .map((i) => career.system.skills?.[Number(i)])
    .map((name) => actor.itemTypes.skill.find((s) => s.name === name))
    .filter(Boolean);
  if (!skills.length) {
    ui.notifications.warn(t("WDT.Income.NoSkills"));
    return false;
  }

  let skill = skills[0];
  if (skills.length > 1) {
    skill = await chooseSkill(skills);
    if (!skill) return false;
  }

  const { income, doubled } = incomeOptionFor(actor, activity.timestamp);
  const options = {
    title: `${skill.name} - ${t("Income")}`,
    income, // { standing, tier } -> system wypłaca natywnie (houserule: 2× standing w dzień pracy)
    career: career.toObject(),
    fields: { modifier: statusRollModifier(actor) },
  };
  const test = await actor.setupSkill(skill, options);
  if (!test) return false;
  await test.roll();

  const { sl } = readResult(test);
  // Kwota w bp z dokładnością ułamkową (scaler ustawia "<bp>b", np. "6.75b") → zapis z ćwierćpensem.
  const bp = earnedStrToBpExact(test.result?.earned);
  let payout = bp > 0 ? moneyText(bp, actor) : test.result?.incomeResult || t("WDT.Failed");
  if (doubled && bp > 0) payout += ` (${t("WDT.Income.Workday")})`;

  // Opcjonalne automatyczne dodanie kasy na kartę (domyślnie wył.) — dokładnie, z ćwierćpensem.
  if (game.settings.get(MODULE_ID, "autoAddIncome") && bp > 0) {
    // NAJPIERW wyłącz przycisk „Zastosuj" Income Scalera (flaga), POTEM dodaj kasę —
    // inaczej przycisk mógłby zdążyć się wyrenderować jako aktywny (race → podwójne dodanie).
    try {
      await test.message?.setFlag("wfrp4e-income-scaler", "applied", true);
    } catch (e) {
      /* best-effort: brak wiadomości/uprawnień do flagi */
    }
    try {
      await addBpToActor(actor, bp);
    } catch (e) {
      console.error("WDT | autoAddIncome failed", e);
    }
  }

  await updateActivity(actor, activity.id, {
    status: "done",
    label: skill.name, // karta nazwana umiejętnością zarobkową
    earnedBp: bp, // zarobek dnia (do sumy w połączonej komórce)
    log: [...activity.log, logEntry(payout, sl, payout, Number(test.result?.roll) || null)],
  });
  return true;
}

/** Dzień przygody/podróży — bez rzutu; realizuje dzień (koszt utrzymania). */
async function execAdventure(actor, activity) {
  const summary = (activity.note || "").trim() || t("WDT.Adventure.Default");
  await updateActivity(actor, activity.id, { status: "done", log: [...activity.log, logEntry(summary, 0)] });
  return true;
}

/** Leczenie u kapłanek — bez rzutu; koszt = utrzymanie + dopłata × dolegliwości (ręcznie). */
async function execHealing(actor, activity) {
  const n = Math.max(0, Number(activity.ailments) || 0);
  await updateActivity(actor, activity.id, {
    status: "done",
    log: [...activity.log, logEntry(t("WDT.Healing.Summary", { n }), 0)],
  });
  return true;
}

/** Odpoczynek — natywny rzut Heal/Endurance (rest). NIE realizuje dnia, bez kosztu. */
async function execRest(actor, activity) {
  const skill = actor.itemTypes.skill?.find((s) => s.name === game.i18n.localize("NAME.Endurance"));
  const opts = { rest: true, tb: actor.system?.characteristics?.t?.bonus ?? 0, skipTargets: true };
  const test = skill ? await actor.setupSkill(skill, opts) : await actor.setupCharacteristic("t", opts);
  if (!test) return false;
  await test.roll();
  const { sl } = readResult(test);
  // Pokazujemy liczbę PS (leczenie = WT + PS, więc nawet ujemne PS częściowo leczą).
  const slStr = `${sl >= 0 ? "+" : ""}${sl}`;
  await updateActivity(actor, activity.id, {
    status: "done",
    log: [...activity.log, logEntry(`${slStr} ${t("WDT.SL")}`, sl, null, Number(test.result?.roll) || null, Number(test.result?.target) || null)],
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Koszt utrzymania                                                    */
/* ------------------------------------------------------------------ */

/** Koszt dnia na 1 poziom standingu dla tieru (z ustawień; fallback do domyślnej). */
function costPerLevelFor(tier) {
  const key = tier === "s" ? "costSilver" : tier === "g" ? "costGold" : "costBrass";
  const v = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST_PER_LEVEL[tier] ?? 0;
}

/** Formuła dopłaty za leczenie dla tieru (z ustawień; fallback do domyślnej). */
function healRuleFor(tier) {
  const key = tier === "s" ? "healSilver" : tier === "g" ? "healGold" : "healBrass";
  const v = game.settings.get(MODULE_ID, key);
  return typeof v === "string" && v.trim() ? v : DEFAULT_HEAL_RULE[tier] ?? "0";
}

/**
 * Bezpieczne policzenie formuły dopłaty leczenia (tylko arytmetyka) ze zmiennymi `daily`, `standing`.
 * Liczone przez Foundry Roll (deterministycznie); błędna formuła → 0 (nic nie wybucha).
 */
function evalHealRule(formula, daily, standing) {
  const f = String(formula ?? "").trim();
  if (!f) return 0;
  try {
    const expr = f.replace(/\bdaily\b/gi, "(@daily)").replace(/\bstanding\b/gi, "(@standing)");
    const r = new Roll(expr, { daily, standing });
    r.evaluateSync();
    return Math.max(0, Number(r.total) || 0);
  } catch (e) {
    return 0;
  }
}

/** Normalizuje tier WFRP4e do klucza tabeli: "b" | "s" | "g". */
function tierKey(tier) {
  const s = String(tier ?? "").toLowerCase();
  if (s === "b" || s === "s" || s === "g") return s;
  const map = {
    "0": "b", "1": "s", "2": "g",
    brass: "b", silver: "s", gold: "g",
    "brąz": "b", brass1: "b", "mosiądz": "b", srebro: "s", "złoto": "g",
  };
  return map[s] ?? "b";
}

/** Nick gracza-właściciela aktora (do whisperu karty zapłaty). */
function ownerPlayerName(actor) {
  const u =
    game.users.find((u) => !u.isGM && u.active && actor.testUserPermission(u, "OWNER")) ??
    game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
  return u?.name;
}

/** Status aktora znormalizowany: {tier:'b'|'s'|'g', standing:number}. */
function statusOf(actor) {
  const s = actor.system?.details?.status ?? {};
  return { tier: tierKey(s.tier), standing: Number(s.standing) || 0 };
}

/* Drabina statusów: Brąz1..Złoto5 (15 stopni); offset standardu życia ±1 może przekroczyć tier. */
const TIER_ORDER = { b: 0, s: 1, g: 2 };
const TIER_LETTERS = ["b", "s", "g"];
export function ladderIndex(tier, standing) {
  const ti = TIER_ORDER[tier] ?? 0;
  const st = Math.min(5, Math.max(1, Number(standing) || 1));
  return ti * 5 + (st - 1);
}
export function fromLadder(i) {
  const idx = Math.min(14, Math.max(0, Math.round(Number(i) || 0)));
  return { tier: TIER_LETTERS[Math.floor(idx / 5)], standing: (idx % 5) + 1 };
}
/** Efektywny status aktora do KOSZTU (z offsetem standardu życia, ±1 stopień drabiny). */
export function effectiveStatus(actor) {
  const base = statusOf(actor);
  const off = getStandingOffset(actor);
  if (!off) return base;
  return fromLadder(ladderIndex(base.tier, base.standing) + off);
}

/** Koszt jednego dnia w groszach (bp). Dzień = pole(tier) × standing; healing → + formuła × dolegliwości. */
export function dayCostBp(actor, { healing = false, ailments = 0 } = {}) {
  const { tier, standing: st } = effectiveStatus(actor); // uwzględnia standard życia (offset, też tier)
  const standing = Math.min(5, Math.max(1, st || 1));
  const daily = costPerLevelFor(tier) * standing;
  let bp = daily;
  if (healing) bp += evalHealRule(healRuleFor(tier), daily, standing) * (Number(ailments) || 0);
  // Bez zaokrąglania — round dopiero przy płatności/wyświetlaniu (ułamki dzienne sumują się po okresie).
  return Math.max(0, bp);
}

/**
 * Modyfikator do CELU testów robionych z osi (Test/Wydłużony/Dochód) wg statusu Z KARTY (statusOf — bez offsetu
 * kosztu). Kumulatywnie po drabinie: +stawka_Brąz/poziom Brązu, +stawka_Srebro/poziom Srebra, +stawka_Złoto/poziom
 * Złota; zaokrąglane w górę. 0/0/0 = brak modyfikatora.
 */
export function statusRollModifier(actor) {
  const numSet = (key, def) => {
    const v = Number(game.settings.get(MODULE_ID, key));
    return Number.isFinite(v) ? v : def;
  };
  const rB = numSet("rollModBrass", DEFAULT_ROLL_MOD_RATE.b);
  const rS = numSet("rollModSilver", DEFAULT_ROLL_MOD_RATE.s);
  const rG = numSet("rollModGold", DEFAULT_ROLL_MOD_RATE.g);
  const { tier, standing } = statusOf(actor); // STATUS Z KARTY (nie effectiveStatus)
  const st = Math.max(0, Math.min(5, Number(standing) || 0));
  const bLv = tier === "b" ? st : 5;
  const sLv = tier === "b" ? 0 : tier === "s" ? st : 5;
  const gLv = tier === "g" ? st : 0;
  return Math.ceil(bLv * rB + sLv * rS + gLv * rG);
}

/* --- Modyfikatory kosztu dni (świat, MG) --- */
/** Słownik modyfikatorów: { "<dayIndex>": { factor, note } }. */
function getCostModifiers() {
  try {
    const raw = game.settings.get(MODULE_ID, "costModifiers");
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    return p && typeof p === "object" ? p : {};
  } catch (e) {
    return {};
  }
}
/** Modyfikator dla dnia: { factor (≥0, default 1), note }. */
export function costModifierFor(dayIndex) {
  const m = getCostModifiers()[String(dayIndex)];
  const f = Number(m?.factor);
  return { factor: Number.isFinite(f) && f >= 0 ? f : 1, note: m?.note ?? "" };
}
/** Koszt dnia z mnożnikiem MG. */
export function dayCostBpOn(actor, dayIndex, opts = {}) {
  return dayCostBp(actor, opts) * costModifierFor(dayIndex).factor;
}
/** Ustaw/usuń modyfikatory dla listy dni (factor===1 lub brak → usuń wpis). GM. */
export async function setDayModifiers(dayIndexes, factor, note = "") {
  const all = getCostModifiers();
  const f = Number(factor);
  for (const d of dayIndexes) {
    if (!Number.isFinite(f) || f === 1) delete all[String(d)];
    else all[String(d)] = { factor: f, note: String(note || "") };
  }
  return game.settings.set(MODULE_ID, "costModifiers", JSON.stringify(all));
}

/** Kwota bp → string walut (lokalizowane skróty). */
export function bpToMoneyStr(bp) {
  const market = game.wfrp4e?.market;
  if (!market?.makeSomeChange || !market?.amountToString) return null;
  return market.amountToString(market.makeSomeChange(Math.max(0, Math.round(bp))));
}

/** Potwierdzenie pobrania (lub braku środków) kosztu — whisper do właściciela + GM. */
function postCostPaidCard(actor, amountStr, product, failed = false) {
  const player = ownerPlayerName(actor);
  const whisper = player ? game.users.filter((u) => u.isGM || u.name === player).map((u) => u.id) : undefined;
  const text = failed ? t("WDT.Cost.NotPaid", { product }) : t("WDT.Cost.Paid", { amount: amountStr, product });
  ChatMessage.create({
    content: `<div class="wdt-cost-paid${failed ? " wdt-cost-failed" : ""}"><b>${actor.name}</b> — ${text}</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
  });
}

/**
 * Pojedyncze zajęcie: ZAMROŻENIE kosztu na karcie (z chwili rzutu) + pobranie.
 * Auto-pobieranie → odejmij dokładnie ¼p i oznacz `paid` (chip pojawi się od razu).
 * Ręczne → wystaw naszą kartę „Zapłać" (chip pojawi się dopiero po kliknięciu).
 */
async function chargeSingleUpkeep(actor, activity) {
  if (!game.settings.get(MODULE_ID, "postCostOfLiving")) return;
  try {
    const healing = activity.type === "healing";
    const ailments = Number(activity.ailments) || 0;
    const bp = dayCostBpOn(actor, timestampToDayIndex(activity.timestamp), { healing, ailments });
    if (bp <= 0) return;
    await updateActivity(actor, activity.id, { costBp: bp });
    const product =
      (healing ? t("WDT.Cost.Healing", { n: ailments }) : t("WDT.Cost.Upkeep")) + ` — ${formatDateShort(activity.timestamp)}`;
    if (game.settings.get(MODULE_ID, "autoPayCostOfLiving")) {
      let paid = false;
      try {
        paid = await payBpFromActor(actor, bp);
      } catch (e) {
        console.error("WDT | autoPay failed", e);
      }
      if (paid) await updateActivity(actor, activity.id, { paid: true });
      postCostPaidCard(actor, moneyText(bp, actor), product, !paid);
    } else {
      await postUpkeepCard(actor, [{ id: activity.id, bp }], bp, product);
    }
  } catch (e) {
    console.error("WDT | chargeSingleUpkeep failed", e);
  }
}

/**
 * Batch: utworzone karty mają już `costBp` (zamrożony). Pobierz zbiorczo (auto → oznacz `paid`)
 * lub wystaw jedną kartę „Zapłać" za cały zakres (chip po kliknięciu).
 */
async function finishBatchUpkeep(actor, created, { healing = false, ailments = 0 } = {}) {
  if (!game.settings.get(MODULE_ID, "postCostOfLiving")) return;
  const items = created.filter((a) => Number(a.costBp) > 0).map((a) => ({ id: a.id, bp: a.costBp }));
  const total = items.reduce((s, it) => s + it.bp, 0);
  if (total <= 0) return;
  const from = formatDateShort(created[0].timestamp);
  const to = formatDateShort(created[created.length - 1].timestamp);
  const base = healing ? t("WDT.Cost.Healing", { n: Number(ailments) || 0 }) : t("WDT.Cost.Upkeep");
  const product = `${base} — ${t("WDT.Cost.UpkeepRange", { from, to, days: created.length })}`;
  if (game.settings.get(MODULE_ID, "autoPayCostOfLiving")) {
    let paid = false;
    try {
      paid = await payBpFromActor(actor, total);
    } catch (e) {
      console.error("WDT | batch autoPay failed", e);
    }
    if (paid) {
      const list = getActivities(actor);
      const ids = new Set(items.map((it) => it.id));
      for (const a of list) if (ids.has(a.id)) a.paid = true;
      await setActivities(actor, list);
    }
    postCostPaidCard(actor, moneyText(total, actor), product, !paid);
  } else {
    await postUpkeepCard(actor, items, total, product);
  }
}

/** Mały wybór umiejętności (gdy kariera ma kilka umiejętności zarobkowych). */
async function chooseSkill(skills) {
  const { DialogV2 } = foundry.applications.api;
  const opts = skills.map((s, i) => `<option value="${i}">${s.name}</option>`).join("");
  const content = `<form><div class="form-group"><label>${t("WDT.Income.ChooseSkill")}</label><select name="idx">${opts}</select></div></form>`;
  const idx = await DialogV2.prompt({
    window: { title: t("WDT.Income.ChooseSkill"), icon: "fa-solid fa-coins" },
    content,
    rejectClose: false,
    ok: {
      label: t("WDT.Save"),
      callback: (event, button, dialog) => (dialog?.element ?? button.form).querySelector('[name="idx"]').value,
    },
  });
  return idx == null ? null : skills[Number(idx)];
}

/* ------------------------------------------------------------------ */
/* Tworzenie testu wydłużonego z poziomu modułu                        */
/* ------------------------------------------------------------------ */

/** Tworzy natywny item extendedTest na karcie; zwraca item (jego id -> activity.extendedTestId). */
export async function createExtendedTest(actor, { name, value, target } = {}) {
  const [item] = await actor.createEmbeddedDocuments("Item", [
    {
      name: name || t("WDT.Type.extended"),
      type: "extendedTest",
      system: {
        test: { value: value || "" },
        SL: { current: 0, target: Math.max(1, Number(target) || 1) },
        difficulty: { value: "challenging" },
      },
    },
  ]);
  return item;
}

/* ------------------------------------------------------------------ */
/* Tryb wielu dni (batch) — po cichu, zbiorczo                         */
/* ------------------------------------------------------------------ */

/** Klucz cechy dla wartości testu (cecha vs umiejętność). */
function charKeyFor(value) {
  const chars = game.wfrp4e?.config?.characteristics ?? {};
  if (chars[value]) return value;
  const entry = Object.entries(chars).find(([, label]) => label === value);
  return entry?.[0] ?? null;
}

/** Wybór itemu testu wydłużonego (gdy kilka). */
async function chooseExtended(items) {
  const { DialogV2 } = foundry.applications.api;
  const opts = items.map((it, i) => `<option value="${i}">${it.name}</option>`).join("");
  const content = `<form><div class="form-group"><label>${t("WDT.PickExtended")}</label><select name="idx">${opts}</select></div></form>`;
  const idx = await DialogV2.prompt({
    window: { title: t("WDT.PickExtended"), icon: "fa-solid fa-hourglass-half" },
    content,
    rejectClose: false,
    ok: { label: t("WDT.Save"), callback: (e, b, d) => (d?.element ?? b.form).querySelector('[name="idx"]').value },
  });
  return idx == null ? null : items[Number(idx)];
}

/** Jedno podsumowanie batcha na czacie (whisper do właściciela + GM). */
function postBatchSummary(actor, html) {
  const player = ownerPlayerName(actor);
  const whisper = player ? game.users.filter((u) => u.isGM || u.name === player).map((u) => u.id) : undefined;
  ChatMessage.create({
    content: `<div class="wdt-batch-summary"><b>${actor.name}</b> — ${html}</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper,
  });
}

/** Punkt wejścia batcha. */
export async function batchResolve(actor, type, dayIdxs, { ailments = 0, upkeep = true, note = "" } = {}) {
  if (!isWfrpActor(actor)) {
    ui.notifications.error(t("WDT.NotWFRP"));
    return;
  }
  try {
    switch (type) {
      case "income":
        return batchIncome(actor, dayIdxs);
      case "adventure":
        return batchSimple(actor, dayIdxs, "adventure", upkeep, note);
      case "healing":
        return batchHealing(actor, dayIdxs, ailments, note);
      case "extended":
        return batchExtended(actor, dayIdxs);
      default:
        return;
    }
  } catch (e) {
    console.error("WDT | batchResolve failed", e);
    ui.notifications.error(t("WDT.Plan.Error"));
  }
}

/**
 * Batch: dochód — okno rzutu RAZ (dzień 1), ciche testy dni 2..N (jak wydłużony).
 * Ścieżka testu daje precyzję bp (Income Scaler liczy per-PS); kasa dodana raz.
 */
async function batchIncome(actor, dayIdxs) {
  const career = actor.itemTypes.career?.find((c) => c.system.current?.value);
  if (!career) return ui.notifications.warn(t("WDT.Income.NoCareer"));
  const skills = (career.system.incomeSkill ?? [])
    .map((i) => career.system.skills?.[Number(i)])
    .map((name) => actor.itemTypes.skill.find((s) => s.name === name))
    .filter(Boolean);
  if (!skills.length) return ui.notifications.warn(t("WDT.Income.NoSkills"));
  let skill = skills[0];
  if (skills.length > 1) {
    skill = await chooseSkill(skills);
    if (!skill) return;
  }

  const careerData = career.toObject();
  const title = `${skill.name} - ${t("Income")}`;
  const rollMod = statusRollModifier(actor); // modyfikator wg statusu z karty (stały na wszystkie dni)

  let totalBp = 0;
  const cards = [];
  for (let k = 0; k < dayIdxs.length; k++) {
    const ts = dayIndexToTimestamp(dayIdxs[k]);
    const { income, doubled } = incomeOptionFor(actor, ts); // houserule: 2× standing w dzień pracy
    // skipDialog: dzień 1 z oknem, reszta po cichu (bypass warhammer-lib), pełny pipeline.
    const test = await actor.setupSkill(skill, { title, income, career: careerData, fields: { modifier: rollMod }, skipDialog: k > 0 });
    if (!test) return; // anulowano okno dnia 1 → przerwij cały batch
    await test.roll();
    try {
      await test.message?.delete?.();
    } catch (e) {
      /* best-effort: bez karty na czacie */
    }
    const bp = earnedStrToBpExact(test.result?.earned); // zachowaj ułamek (ćwierćpensy)
    totalBp += bp;
    let dayStr = bp > 0 ? moneyText(bp, actor) : `${bp}`;
    if (doubled && bp > 0) dayStr += ` (${t("WDT.Income.Workday")})`;
    cards.push({
      type: "income",
      timestamp: ts,
      status: "done",
      label: skill.name,
      costBp: dayCostBpOn(actor, dayIdxs[k], {}),
      earnedBp: bp, // zarobek dnia (do sumy w połączonej komórce)
      log: [logEntry(dayStr, Math.trunc(Number(test.result?.SL) || 0), dayStr, Number(test.result?.roll) || null)],
    });
  }
  // Najpierw zapis kart dni (realizacja widoczna na osi), potem kasa (odporne na błąd).
  const created = await addActivities(actor, cards);
  if (totalBp > 0) {
    try {
      // Dokładnie, z ćwierćpensem (bez generycznej karty „Kredyt") — okres w naszym podsumowaniu.
      await addBpToActor(actor, totalBp);
    } catch (e) {
      console.error("WDT | batchIncome credit failed", e);
    }
  }
  await finishBatchUpkeep(actor, created, {});
  const from = formatDateShort(dayIndexToTimestamp(dayIdxs[0]));
  const to = formatDateShort(dayIndexToTimestamp(dayIdxs[dayIdxs.length - 1]));
  postBatchSummary(
    actor,
    t("WDT.Batch.SummaryIncome", { days: dayIdxs.length, from, to, total: moneyText(totalBp, actor) })
  );
}

/** Batch: przygoda (bez rzutu); koszt opcjonalny (upkeep) + notatka. */
async function batchSimple(actor, dayIdxs, type, upkeep = true, note = "") {
  const summary = (note || "").trim() || t("WDT.Adventure.Default");
  const cards = dayIdxs.map((dayIdx) => ({
    type,
    timestamp: dayIndexToTimestamp(dayIdx),
    status: "done",
    upkeep, // czy ten dzień nalicza koszt (wpływa też na chip w komórce)
    note: note || "",
    label: t(`WDT.Type.${type}`),
    costBp: upkeep ? dayCostBpOn(actor, dayIdx, {}) : 0,
    log: [logEntry(summary, 0)],
  }));
  const created = await addActivities(actor, cards);
  await finishBatchUpkeep(actor, created, {});
  postBatchSummary(actor, t("WDT.Batch.SummarySimple", { type: t(`WDT.Type.${type}`), days: dayIdxs.length }));
}

/** Batch: leczenie (bez rzutu) — koszt z dopłatą × dolegliwości; notatka „u kogo". */
async function batchHealing(actor, dayIdxs, ailments, note = "") {
  const n = Math.max(0, Number(ailments) || 0);
  const cards = dayIdxs.map((dayIdx) => ({
    type: "healing",
    timestamp: dayIndexToTimestamp(dayIdx),
    status: "done",
    ailments: n,
    note: note || "",
    label: t("WDT.Type.healing"),
    costBp: dayCostBpOn(actor, dayIdx, { healing: true, ailments: n }),
    log: [logEntry(t("WDT.Healing.Summary", { n }), 0)],
  }));
  const created = await addActivities(actor, cards);
  await finishBatchUpkeep(actor, created, { healing: true, ailments: n });
  postBatchSummary(actor, t("WDT.Batch.SummarySimple", { type: t("WDT.Type.healing"), days: dayIdxs.length }));
}

/**
 * Batch: test wydłużony — natywny silnik per dzień (jak batchIncome): okno RAZ (dzień 1),
 * dni 2..N po cichu (skipDialog). Silnik sam liczy PS (slBonus zawsze, successBonus tylko na
 * sukcesie) i aktualizuje SL itemu przez handleExtendedTest — zero ręcznej formuły.
 */
async function batchExtended(actor, dayIdxs) {
  const items = actor.itemTypes.extendedTest ?? [];
  let item = items[0];
  if (items.length > 1) {
    item = await chooseExtended(items);
    if (!item) return;
  }
  if (!item) return ui.notifications.warn(t("WDT.ExtendedMissing"));
  if ((item.system.SL?.target ?? 0) <= 0) return ui.notifications.warn(t("WDT.ExtendedMissing"));

  const itemId = item.id;
  const value = item.system.test?.value;
  const charKey = charKeyFor(value);
  const defaultRollMode = item.system.hide?.test || item.system.hide?.progress ? "gmroll" : "roll";
  const before = item.system.SL?.current ?? 0;
  const target = Math.max(1, item.system.SL?.target ?? 1);

  const cards = [];
  let totalGain = 0; // suma realnych PS dni (spójna z kartami, też przy reset/remove)
  // Ręczne bonusy talentów (np. +2 successBonus „na sukcesie") to dialog-scripty aktywowane PTASZKIEM w oknie.
  // Dni 2..N idą z skipDialog (bypass) → te skrypty się NIE odpalają. Dlatego przenosimy successBonus/slBonus
  // policzone w oknie DNIA 1 do `fields` cichych dni (ctx.fields → preData → computeResult).
  let carryBonus = null;
  const rollMod = statusRollModifier(actor); // modyfikator wg statusu z karty (stały na wszystkie dni)
  for (let k = 0; k < dayIdxs.length; k++) {
    const fresh = actor.items.get(itemId);
    if (!fresh) break; // test ukończony i usunięty (completion="remove")
    const beforeK = fresh.system.SL?.current ?? 0; // SL itemu PRZED tym rzutem
    const ctx = {
      extended: fresh.uuid,
      hitLocation: false,
      fields: {
        difficulty: fresh.system.difficulty?.value || "challenging",
        rollMode: defaultRollMode,
        modifier: rollMod, // modyfikator wg statusu z karty
        ...(carryBonus ?? {}), // dni 2..N: bonusy talentów przeniesione z dnia 1
      },
      appendTitle: ` – ${fresh.name}`,
      skipDialog: k > 0,
    };
    const test = charKey ? await actor.setupCharacteristic(charKey, ctx) : await actor.setupSkill(value, ctx);
    if (!test) return; // anulowano okno dnia 1 → przerwij cały batch
    // Dzień 1 (okno): zapamiętaj ręcznie zaznaczone bonusy talentów (NIE modifier — Advantage doliczyłaby się 2×).
    if (k === 0) {
      carryBonus = {
        successBonus: Number(test.data?.preData?.successBonus) || 0,
        slBonus: Number(test.data?.preData?.slBonus) || 0,
      };
    }
    await test.roll(); // natywnie aktualizuje SL itemu (handleExtendedTest)
    try {
      await test.message?.delete?.();
    } catch (e) {
      /* best-effort: bez karty na czacie */
    }
    // PS tego dnia = REALNY przyrost SL itemu (delta), NIE surowy test.result.SL — honoruje
    // talenty/failingDecreases/negativePossible. Guard na brak itemu (remove nieużywane) → 0 wkładu.
    const afterItem = actor.items.get(itemId);
    const afterK = afterItem ? (afterItem.system.SL?.current ?? beforeK) : beforeK;
    const gain = Math.trunc(afterK - beforeK);
    totalGain += gain;
    cards.push(
      extCard(
        dayIdxs[k],
        itemId,
        gain,
        Number(test.result?.roll) || null,
        Number(test.result?.target) || null,
        dayCostBpOn(actor, dayIdxs[k], {})
      )
    );
  }

  const created = await addActivities(actor, cards);
  // SL itemu zaktualizował natywnie handleExtendedTest — NIE nadpisujemy. Po remove item nie istnieje → cel.
  const finalItem = actor.items.get(itemId);
  const current = finalItem ? (finalItem.system.SL?.current ?? before) : target;
  await finishBatchUpkeep(actor, created, {});
  postBatchSummary(actor, t("WDT.Batch.SummaryExtended", {
    name: item.name,
    days: dayIdxs.length,
    gained: totalGain, // suma realnych PS dni (zgodna z kartami)
    current,
    target,
  }));
}

function extCard(dayIdx, itemId, gain, roll = null, target = null, costBp = 0) {
  return {
    type: "extended",
    timestamp: dayIndexToTimestamp(dayIdx),
    status: "done", // dzień zrealizowany po rzucie (nie wg ukończenia całego testu)
    extDay: true,
    extendedTestId: itemId,
    costBp,
    log: [logEntry(`${gain >= 0 ? "+" : ""}${gain} ${t("WDT.SL")}`, gain, null, roll, target)],
  };
}
