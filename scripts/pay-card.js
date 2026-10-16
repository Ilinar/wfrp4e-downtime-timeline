/**
 * Własna karta „Zapłać" za koszt utrzymania. W przeciwieństwie do natywnej karty WFRP daje nam
 * pewny sygnał akceptacji: dopiero po kliknięciu oznaczamy zajęcia jako opłacone (`paid:true`),
 * przez co chip kosztu pojawia się na osi DOPIERO po zapłacie. Pobiera dokładnie co do ¼p.
 *
 * Brak importu templates.js / timeline-app.js — oś odświeżamy przez publiczne API modułu,
 * żeby nie tworzyć cyklu importów.
 */

import { MODULE_ID, t } from "./const.js";
import { moneyText, payBpFromActor } from "./money.js";
import { getActivity, updateActivity } from "./activities.js";

/** Whisper do właścicieli aktora (gracz + GM). */
function ownerUserIds(actor) {
  return game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id);
}

/** HTML karty (stan zapłacony / do zapłaty). */
function cardHtml(actor, product, total, paid) {
  const amount = moneyText(total, actor);
  const head = `<div class="wdt-upkeep-head"><b>${actor.name}</b>${product ? " — " + product : ""}</div>`;
  if (paid) {
    return `<div class="wdt-upkeep-card wdt-upkeep-paid">${head}
      <div class="wdt-upkeep-done"><i class="fa-solid fa-check"></i> ${t("WDT.Pay.Paid")}: ${amount}</div></div>`;
  }
  return `<div class="wdt-upkeep-card">${head}
    <button type="button" class="wdt-pay-btn"><i class="fa-solid fa-coins"></i> ${t("WDT.Pay.Button", { amount })}</button></div>`;
}

/**
 * Wystawia kartę „Zapłać" za koszt utrzymania.
 * @param {Actor} actor
 * @param {{id:string, bp:number}[]} items  zajęcia do oznaczenia jako opłacone po zapłacie
 * @param {number} total  łączny koszt (bp)
 * @param {string} product  opis (np. „Koszt utrzymania — 14 Sigmarzeit")
 */
export async function postUpkeepCard(actor, items, total, product = "") {
  if (!(total > 0) || !items?.length) return;
  await ChatMessage.create({
    content: cardHtml(actor, product, total, false),
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: ownerUserIds(actor),
    flags: { [MODULE_ID]: { upkeepPay: { actorId: actor.id, items, total, product, paid: false } } },
  });
}

/** Po renderze wiadomości czatu: podepnij przycisk „Zapłać" naszej karty. */
export function wireUpkeepCard(message, html) {
  const data = message?.getFlag?.(MODULE_ID, "upkeepPay");
  if (!data) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const btn = root?.querySelector(".wdt-pay-btn");
  if (!btn || btn.dataset.wdtWired) return; // anty-dubel (gdyby oba haki czatu odpaliły)
  btn.dataset.wdtWired = "1";
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    btn.disabled = true; // anty-dubel w obrębie jednego klienta
    await payUpkeep(message);
  });
}

/** Realizacja płatności: pobierz kasę (¼p), oznacz zajęcia opłacone, zaktualizuj kartę, odśwież oś. */
export async function payUpkeep(message) {
  const data = message?.getFlag?.(MODULE_ID, "upkeepPay");
  if (!data || data.paid) return;
  const actor = game.actors.get(data.actorId);
  if (!actor?.isOwner) return ui.notifications.warn(t("WDT.Pay.NotOwner"));

  // Zabezpieczenie przed podwójną zapłatą, gdy aktualizacja flagi wiadomości się nie powiedzie
  // (np. gracz klika kartę utworzoną przez GM): jeśli zajęcia już opłacone → przerwij.
  const first = data.items?.[0];
  if (first && getActivity(actor, first.id)?.paid) return;

  const ok = await payBpFromActor(actor, data.total);
  if (!ok) return ui.notifications.warn(t("WDT.Cost.NotPaid", { product: data.product || t("WDT.Cost.Upkeep") }));

  for (const it of data.items) await updateActivity(actor, it.id, { paid: true });

  // Aktualizacja karty na „Zapłacono" — best-effort (gracz może nie być autorem wiadomości GM).
  try {
    await message.update({
      content: cardHtml(actor, data.product, data.total, true),
      [`flags.${MODULE_ID}.upkeepPay.paid`]: true,
    });
  } catch (e) {
    /* brak uprawnień do edycji cudzej wiadomości — kasa i tak pobrana, chip się pokaże */
  }
  game.modules.get(MODULE_ID)?.api?.refresh?.();
}
