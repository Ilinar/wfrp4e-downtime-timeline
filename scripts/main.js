/**
 * Punkt wejścia modułu: ustawienia, przycisk w pasku narzędzi sceny,
 * odświeżanie osi na zmianę czasu / aktora, publiczne API.
 */

import { MODULE_ID, DEFAULT_DAYS_TO_SHOW, DEFAULT_COST_PER_LEVEL, DEFAULT_HEAL_RULE, DEFAULT_ROLL_MOD_RATE, t } from "./const.js";
import { onTimeChange } from "./sc.js";
import { openTimeline, refreshTimeline } from "./timeline-app.js";
import { wireUpkeepCard } from "./pay-card.js";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "daysToShow", {
    name: "WDT.Settings.DaysToShow.Name",
    hint: "WDT.Settings.DaysToShow.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULT_DAYS_TO_SHOW,
    range: { min: 5, max: 40, step: 1 },
    onChange: () => refreshTimeline(),
  });

  // Koszt utrzymania — 3 pola dzienne (bp na 1 poziom standingu; koszt dnia = pole × standing).
  for (const [tier, key] of [["b", "costBrass"], ["s", "costSilver"], ["g", "costGold"]]) {
    game.settings.register(MODULE_ID, key, {
      name: `WDT.Settings.${key}.Name`,
      hint: `WDT.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type: Number,
      default: DEFAULT_COST_PER_LEVEL[tier],
      range: { min: 0, max: 1000, step: 0.25 },
      onChange: () => refreshTimeline(),
    });
  }

  // Dopłata za leczenie — edytowalna FORMUŁA per tier (zmienne `daily`, `standing`); za każdą dolegliwość.
  for (const [tier, key] of [["b", "healBrass"], ["s", "healSilver"], ["g", "healGold"]]) {
    game.settings.register(MODULE_ID, key, {
      name: `WDT.Settings.${key}.Name`,
      hint: `WDT.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type: String,
      default: DEFAULT_HEAL_RULE[tier],
      onChange: () => refreshTimeline(),
    });
  }

  // Modyfikator do celu testów z osi (Test/Wydłużony/Dochód) wg statusu z karty — stawka na poziom tieru.
  for (const [tier, key] of [["b", "rollModBrass"], ["s", "rollModSilver"], ["g", "rollModGold"]]) {
    game.settings.register(MODULE_ID, key, {
      name: `WDT.Settings.${key}.Name`,
      hint: `WDT.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type: Number,
      default: DEFAULT_ROLL_MOD_RATE[tier],
      range: { min: 0, max: 100, step: 0.25 },
      onChange: () => refreshTimeline(),
    });
  }

  // Globalny włącznik kart kosztu utrzymania.
  game.settings.register(MODULE_ID, "postCostOfLiving", {
    name: "WDT.Settings.PostCost.Name",
    hint: "WDT.Settings.PostCost.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Automatyczne dodawanie kasy za pojedynczy dochód (domyślnie wył. — działa przycisk
  // „Zastosuj" Income Scalera; po włączeniu kasa trafia na kartę od razu).
  game.settings.register(MODULE_ID, "autoAddIncome", {
    name: "WDT.Settings.AutoAddIncome.Name",
    hint: "WDT.Settings.AutoAddIncome.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Automatyczne pobieranie kosztu utrzymania (zamiast klikalnej karty „Zapłać").
  // Działa tylko gdy „Karty kosztu utrzymania" włączone; przy braku środków nic nie pobiera.
  game.settings.register(MODULE_ID, "autoPayCostOfLiving", {
    name: "WDT.Settings.AutoPayCost.Name",
    hint: "WDT.Settings.AutoPayCost.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Houserule: w pierwszy dzień tygodnia (kalendarz imperialny z Simple Calendar) dochód podwojony.
  game.settings.register(MODULE_ID, "doubleIncomeFirstDay", {
    name: "WDT.Settings.DoubleIncomeFirstDay.Name",
    hint: "WDT.Settings.DoubleIncomeFirstDay.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Modyfikatory kosztu utrzymania dla wybranych dni (MG; edytowane w trybie „Modyfikatory",
  // nie w oknie ustawień). JSON: { "<dayIndex>": { factor, note } }.
  game.settings.register(MODULE_ID, "costModifiers", {
    scope: "world",
    config: false,
    type: String,
    default: "{}",
    onChange: () => refreshTimeline(),
  });

  // Wizualne łączenie sąsiednich identycznych dni (tylko widok; per użytkownik).
  game.settings.register(MODULE_ID, "mergeAdjacent", {
    name: "WDT.Settings.MergeAdjacent.Name",
    hint: "WDT.Settings.MergeAdjacent.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshTimeline(),
  });

  // Widok rosteru per użytkownik: zwinięte grupy (foldery aktorów) i schowane postacie.
  // scope "user" (v13+) — zapis w bazie świata osobno dla każdego użytkownika (gracz może pisać własne).
  game.settings.register(MODULE_ID, "rosterView", {
    scope: "user",
    config: false,
    type: Object,
    default: { collapsed: [], hidden: [] },
  });
});

Hooks.once("ready", () => {
  // Publiczne API — można podpiąć pod makro: game.modules.get(id).api.open()
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { open: openTimeline, refresh: refreshTimeline };

  // Odśwież oś przy zmianie czasu (Simple Calendar lub rdzeniowy worldTime).
  onTimeChange(() => refreshTimeline());

  // Jednorazowa korekta DOMYŚLNYCH kosztów do NOWEJ tabeli — tylko gdy wartość == stary default
  // (nie nadpisuje wartości zmienionych ręcznie; idempotentne).
  if (game.user.isGM) {
    const fixes = [
      ["costSilver", 8.25, 8],
      ["costGold", 30, 48],
      ["healGold", "standing * 15", "standing * 30"],
    ];
    for (const [key, oldDef, newDef] of fixes) {
      try {
        if (game.settings.get(MODULE_ID, key) === oldDef) game.settings.set(MODULE_ID, key, newDef);
      } catch (e) {
        /* best-effort */
      }
    }
  }

  if (game.system.id !== "wfrp4e") {
    console.warn(`${MODULE_ID} | system to '${game.system.id}', nie 'wfrp4e' — mechanika testów/zarobku będzie niedostępna.`);
  }
});

// Odśwież oś, gdy zmienią się zajęcia na dowolnym aktorze albo jego folder/nazwa/portret (grupowanie).
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) refreshTimeline();
  else if ("folder" in changes || "name" in changes || "img" in changes) refreshTimeline();
});

// Odśwież oś, gdy zmienią się foldery aktorów (nazwa/kolor/zagnieżdżenie grup).
const onActorFolderChange = (folder) => {
  if (folder?.type === "Actor") refreshTimeline();
};
Hooks.on("createFolder", onActorFolderChange);
Hooks.on("updateFolder", onActorFolderChange);
Hooks.on("deleteFolder", onActorFolderChange);

// Odśwież oś, gdy zmieni się/utworzy/usunie test wydłużony (SL na karcie).
const onExtendedItemChange = (item) => {
  if (item?.type === "extendedTest") refreshTimeline();
};
Hooks.on("updateItem", onExtendedItemChange);
Hooks.on("createItem", onExtendedItemChange);
Hooks.on("deleteItem", onExtendedItemChange);

// Podpięcie przycisku „Zapłać" naszej karty kosztu utrzymania. v13+/v14: renderChatMessageHTML
// (2. arg = HTMLElement). Stary renderChatMessage jest w v14 zdeprecjonowany — nie rejestrujemy go.
Hooks.on("renderChatMessageHTML", (message, html) => wireUpkeepCard(message, html));

// Przycisk w pasku narzędzi sceny (obsługa układu v13 = obiekt oraz v12 = tablica).
Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "wdt-open",
    title: t("WDT.OpenTimeline"),
    icon: "fa-solid fa-calendar-days",
    button: true,
    visible: true,
    onChange: () => openTimeline(), // v13+/v14 (onClick zdeprecjonowany od v13)
  };

  if (Array.isArray(controls)) {
    // Foundry v12: controls = tablica grup, każda z tools = tablica.
    const group = controls.find((c) => c.name === "token" || c.name === "tokens");
    if (group) group.tools.push(tool);
  } else if (controls && typeof controls === "object") {
    // Foundry v13: controls = obiekt grup keyed by name, tools = obiekt.
    const group = controls.tokens ?? controls.token ?? Object.values(controls)[0];
    if (group?.tools) {
      tool.order = Object.keys(group.tools).length;
      group.tools[tool.name] = tool;
    }
  }
});
