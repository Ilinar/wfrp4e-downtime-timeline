/**
 * Lekkie pickery do skrótów „zrób teraz". Aktor znany z komórki.
 *   - pickTestTarget(actor)     → { kind, value } | null      (umiejętność/cecha)
 *   - pickExtendedTarget(actor) → { extendedTestId } | { newExtended:{name,value,target} } | null
 *   - promptNote(actor)         → string | null               (dzień przygody)
 *   - promptAilments(actor)     → number | null               (leczenie)
 */

import { t } from "./const.js";

/** Posortowane, unikalne nazwy umiejętności aktora. */
function skillNames(actor) {
  const names = (actor?.itemTypes?.skill ?? []).map((s) => s.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Cechy z konfiguracji systemu: [{key, label}]. */
function characteristicChoices() {
  const cfg = game.wfrp4e?.config?.characteristics ?? {};
  return Object.entries(cfg).map(([key, label]) => ({ key, label }));
}

/** Opcje rzutu: umiejętności (value=skill::Nazwa) + cechy (value=char::klucz). */
function rollOptions(actor) {
  return [
    ...skillNames(actor).map((n) => ({ value: `skill::${n}`, name: n })),
    ...characteristicChoices().map((c) => ({ value: `char::${c.key}`, name: c.label })),
  ];
}

function parseRoll(v) {
  const [kind, ...rest] = (v || "skill::").split("::");
  return { kind: kind === "char" ? "char" : "skill", value: rest.join("::") };
}

/** Wybór umiejętności/cechy do zwykłego testu. */
export async function pickTestTarget(actor) {
  const { DialogV2 } = foundry.applications.api;
  const opts = rollOptions(actor);
  if (!opts.length) {
    ui.notifications.warn(t("WDT.NoSkill"));
    return null;
  }
  const html = `<form><div class="form-group"><label>${t("WDT.Field.RollTarget")}</label>
    <select name="rollTarget">${opts.map((o) => `<option value="${o.value}">${o.name}</option>`).join("")}</select>
  </div></form>`;
  const v = await DialogV2.prompt({
    window: { title: t("WDT.PickTest"), icon: "fa-solid fa-dice-d20" },
    content: html,
    rejectClose: false,
    ok: {
      label: t("WDT.Execute"),
      icon: "fa-solid fa-dice-d20",
      callback: (e, b, d) => (d?.element ?? b.form).querySelector('[name="rollTarget"]').value,
    },
  });
  return v == null ? null : parseRoll(v);
}

/** Wybór istniejącego testu wydłużonego z karty lub utworzenie nowego. */
export async function pickExtendedTarget(actor) {
  const { DialogV2 } = foundry.applications.api;
  const items = (actor.itemTypes?.extendedTest ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    sl: `${it.system.SL?.current ?? 0}/${it.system.SL?.target ?? 1}`,
  }));
  const hasExisting = items.length > 0;
  const existingOpts = items.map((it) => `<option value="${it.id}">${it.name} (${it.sl} SL)</option>`).join("");
  const rollOpts = rollOptions(actor).map((o) => `<option value="${o.value}">${o.name}</option>`).join("");

  const html = `<form>
    <div class="form-group"><label>${t("WDT.Extended.Existing")}</label>
      <select name="extendedTestId">${existingOpts}<option value="__new__" ${hasExisting ? "" : "selected"}>➕ ${t("WDT.Extended.CreateNew")}</option></select>
    </div>
    <div class="wdt-new-extended" style="${hasExisting ? "display:none" : ""}">
      <div class="form-group"><label>${t("WDT.Extended.Name")}</label><input type="text" name="newName" placeholder="${t("WDT.Extended.NamePlaceholder")}"/></div>
      <div class="form-group"><label>${t("WDT.Field.RollTarget")}</label><select name="newRollTarget">${rollOpts}</select></div>
      <div class="form-group"><label>${t("WDT.Extended.Target")}</label><input type="number" name="newTarget" value="6" min="1" step="1"/></div>
    </div>
  </form>`;

  Hooks.once("renderDialogV2", (app, element) => {
    const root = element instanceof HTMLElement ? element : app?.element;
    const sel = root?.querySelector('select[name="extendedTestId"]');
    const box = root?.querySelector(".wdt-new-extended");
    const apply = () => {
      if (box) box.style.display = sel?.value === "__new__" ? "" : "none";
    };
    sel?.addEventListener("change", apply);
    apply();
  });

  return DialogV2.prompt({
    window: { title: t("WDT.PickExtended"), icon: "fa-solid fa-hourglass-half" },
    content: html,
    rejectClose: false,
    ok: {
      label: t("WDT.Execute"),
      icon: "fa-solid fa-check",
      callback: (e, b, d) => {
        const root = d?.element ?? b.form;
        const val = (n) => root.querySelector(`[name="${n}"]`)?.value ?? "";
        const sel = val("extendedTestId");
        if (sel === "__new__" || !sel) {
          const r = parseRoll(val("newRollTarget"));
          // Dla cechy item testu wydłużonego trzyma ETYKIETĘ (system findKey po wartości).
          const value = r.kind === "char" ? game.wfrp4e?.config?.characteristics?.[r.value] ?? r.value : r.value;
          return { newExtended: { name: val("newName"), value, target: Number(val("newTarget")) || 1 } };
        }
        return { extendedTestId: sel };
      },
    },
  });
}

/** Notatka + opcjonalny koszt utrzymania dla dnia przygody/podróży. → { note, upkeep } | null */
export async function promptNote(actor) {
  const { DialogV2 } = foundry.applications.api;
  const html = `<form>
    <div class="form-group"><label>${t("WDT.Adventure.NotePrompt")}</label>
      <textarea name="note" rows="3" style="width:100%"></textarea></div>
    <div class="form-group"><label><input type="checkbox" name="upkeep" checked/> ${t("WDT.Adventure.Upkeep")}</label></div>
  </form>`;
  const v = await DialogV2.prompt({
    window: { title: t("WDT.Type.adventure"), icon: "fa-solid fa-person-hiking" },
    content: html,
    rejectClose: false,
    ok: {
      label: t("WDT.Save"),
      icon: "fa-solid fa-check",
      callback: (e, b, d) => {
        const root = d?.element ?? b.form;
        return {
          note: root.querySelector('[name="note"]')?.value ?? "",
          upkeep: !!root.querySelector('[name="upkeep"]')?.checked,
        };
      },
    },
  });
  return v == null ? null : v;
}

/** Leczenie: liczba dolegliwości + „u kogo" (notatka). → { ailments, note } | null */
export async function promptAilments(actor) {
  const { DialogV2 } = foundry.applications.api;
  const html = `<form>
    <div class="form-group"><label>${t("WDT.Healing.AilmentsPrompt")}</label>
      <input type="number" name="ailments" value="1" min="0" step="1" style="width:100%"/></div>
    <div class="form-group"><label>${t("WDT.Healing.HealerPrompt")}</label>
      <input type="text" name="healer" value="${t("WDT.Healing.HealerDefault")}" style="width:100%"/></div>
  </form>`;
  const v = await DialogV2.prompt({
    window: { title: t("WDT.Type.healing"), icon: "fa-solid fa-staff-snake" },
    content: html,
    rejectClose: false,
    ok: {
      label: t("WDT.Save"),
      icon: "fa-solid fa-check",
      callback: (e, b, d) => {
        const root = d?.element ?? b.form;
        return {
          ailments: Number(root.querySelector('[name="ailments"]')?.value) || 0,
          note: root.querySelector('[name="healer"]')?.value ?? "",
        };
      },
    },
  });
  return v == null ? null : v;
}

/** Edycja notatki istniejącego zajęcia (np. przygody / „u kogo" leczenia). → string | null */
export async function promptEditNote(current = "") {
  const { DialogV2 } = foundry.applications.api;
  const esc = String(current).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<form><div class="form-group"><label>${t("WDT.NotePrompt")}</label>
    <textarea name="note" rows="4" style="width:100%">${esc}</textarea></div></form>`;
  const v = await DialogV2.prompt({
    window: { title: t("WDT.EditNote"), icon: "fa-solid fa-pen" },
    content: html,
    rejectClose: false,
    ok: {
      label: t("WDT.Save"),
      icon: "fa-solid fa-check",
      callback: (e, b, d) => (d?.element ?? b.form).querySelector('[name="note"]')?.value ?? "",
    },
  });
  return v == null ? null : v;
}
