/**
 * Obsługa kasy z dokładnością do ćwierćpensa (0,25 bp) — spójna z Income Scalerem
 * (który dla `pennyGranularity:quarter` liczy dochód ułamkowo i wypłaca monetą ¼p).
 *
 * Natywne `game.wfrp4e.market` (makeSomeChange/amountToString/payCommand/parseMoneyTransactionString)
 * operuje WYŁĄCZNIE na całkowitych gc/ss/bp (parseInt ucina ułamki), więc do kwot ułamkowych
 * używamy bezpośrednich aktualizacji ilości monet na karcie:
 *   - addBpToActor  — uznanie (dochód),
 *   - payBpFromActor — obciążenie (koszt utrzymania), z rozmianą gdy trzeba.
 *
 * Wszystkie kwoty kosztów/dochodu w module są „czyste ćwiartkowo" (wielokrotności 0,25),
 * więc zaokrąglenie do ćwiartki nie traci nic istotnego.
 */

/** Rozkład pensów na monety {gc, ss, bp, fa} (fa = liczba ćwierćpensów 0..3). */
export function coinsFromBp(bpExact) {
  const q = Math.max(0, Math.round((Number(bpExact) || 0) * 4)); // suma w ćwiartkach
  let whole = Math.floor(q / 4);
  const fa = q % 4;
  const gc = Math.floor(whole / 240);
  whole %= 240;
  const ss = Math.floor(whole / 12);
  const bp = whole % 12;
  return { gc, ss, bp, fa };
}

/** Nazwa monety o danej wartości (coinValue) z karty; fallback gdy brak. */
function coinNameByValue(actor, value, fallback) {
  const money = actor?.itemTypes?.money ?? actor?.itemTags?.money ?? [];
  const it = money.find?.((m) => Number(m.system?.coinValue?.value) === value);
  return it?.name ?? fallback;
}

/** Skonsolidowany skrót kwoty: „2 ss, 1 bp, 3 ¼p" (pomija zera; ćwierćpens nazwą monety z karty). */
export function moneyText(bpExact, actor = null) {
  const c = coinsFromBp(bpExact);
  const parts = [];
  if (c.gc) parts.push(`${c.gc} gc`);
  if (c.ss) parts.push(`${c.ss} ss`);
  if (c.bp) parts.push(`${c.bp} bp`);
  if (c.fa) parts.push(`${c.fa} ${coinNameByValue(actor, 0.25, "¼p")}`);
  return parts.length ? parts.join(", ") : "0 bp";
}

/** "6.75b" / "7.5s" / "3g" → grosze (bp) BEZ zaokrąglania (zachowuje ułamek). */
export function earnedStrToBpExact(str) {
  const m = String(str ?? "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*([bsg])$/i);
  if (!m) return 0;
  const letter = m[2].toLowerCase();
  const mult = letter === "g" ? 240 : letter === "s" ? 12 : 1;
  return Math.max(0, Number(m[1]) * mult);
}

/**
 * Uznaje (dodaje) na kartę dokładną kwotę w pensach; ułamek → monety ¼p.
 * Wzorzec jak `addIncomeToActor` scalera. Fallback: brak monety bp → natywne (zaokrąglone).
 */
export async function addBpToActor(actor, bpExact) {
  const money = (actor?.itemTypes?.money ?? actor?.itemTags?.money ?? []).map((m) => m.toObject());
  const byVal = (v) => money.find((m) => Number(m.system?.coinValue?.value) === v);
  const bpItem = byVal(1);
  if (!bpItem) {
    const add = game.wfrp4e?.market?.addMoneyTo?.(actor, `${Math.round(bpExact)}b`);
    return add ? actor.updateEmbeddedDocuments("Item", add) : null;
  }
  const q = Math.max(0, Math.round((Number(bpExact) || 0) * 4));
  let whole = Math.floor(q / 4);
  let fa = q % 4;
  const faItem = byVal(0.25);
  if (fa && !faItem) {
    // brak ćwierćpensa → zaokrąglij CAŁĄ kwotę do najbliższego pensa (spójnie, bez gubienia/tworzenia)
    whole = Math.round(Number(bpExact) || 0);
    fa = 0;
  }
  const updates = [];
  const bump = (item, n) => {
    if (!item || !n || n < 0) return; // n zawsze ≥ 0 (Math.max wyżej) — guard defensywny
    item.system.quantity.value = (Number(item.system.quantity.value) || 0) + n;
    updates.push({ _id: item._id, "system.quantity.value": item.system.quantity.value });
  };
  bump(bpItem, whole);
  bump(faItem, fa);
  return updates.length ? actor.updateEmbeddedDocuments("Item", updates) : null;
}

/**
 * Obciąża kartę dokładną kwotą w pensach (ćwiartkowo). Zwraca true/false (false = za mało kasy,
 * nic nie pobrano). Najpierw próbuje zapłacić z istniejących nominałów (bez rozmieniania);
 * gdy się nie da — rozmienia (przelicza całość na jednostki i rozkłada resztę malejąco po wartości).
 */
export async function payBpFromActor(actor, bpExact) {
  const moneyItems = actor?.itemTypes?.money ?? [];
  if (!moneyItems.length) return false;
  const money = moneyItems.map((m) => m.toObject());
  const valOf = (m) => Number(m.system?.coinValue?.value) || 0;
  const qtyOf = (m) => Number(m.system?.quantity?.value) || 0;

  const hasFa = money.some((m) => valOf(m) === 0.25);
  const cost = hasFa ? Math.round(bpExact * 4) / 4 : Math.round(bpExact); // zaokrąglij do dostępnej granulacji
  if (cost <= 0) return true;

  const totalBp = money.reduce((s, m) => s + valOf(m) * qtyOf(m), 0);
  if (totalBp + 1e-9 < cost) return false; // za mało środków

  // 1) Płatność dokładna z istniejących nominałów (bez rozmieniania).
  const c = coinsFromBp(cost);
  const byVal = (v) => money.find((m) => valOf(m) === v);
  const gcI = byVal(240), ssI = byVal(12), bpI = byVal(1), faI = byVal(0.25);
  const enough = (need, it) => !need || (it && qtyOf(it) >= need);
  if (enough(c.gc, gcI) && enough(c.ss, ssI) && enough(c.bp, bpI) && enough(c.fa, faI)) {
    const updates = [];
    const dec = (it, n) => {
      if (it && n) updates.push({ _id: it._id, "system.quantity.value": qtyOf(it) - n });
    };
    dec(gcI, c.gc); dec(ssI, c.ss); dec(bpI, c.bp); dec(faI, c.fa);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    return true;
  }

  // 2) Rozmień: przelicz całość na jednostki (¼ gdy jest moneta ¼p, inaczej pełny pens)
  //    i rozłóż resztę malejąco po wartości monety.
  const unit = hasFa ? 0.25 : 1;
  const uVal = (m) => Math.round(valOf(m) / unit);
  const totalU = money.reduce((s, m) => s + uVal(m) * qtyOf(m), 0);
  let remU = totalU - Math.round(cost / unit);
  if (remU < 0) return false;
  const desc = money.filter((m) => uVal(m) > 0).sort((a, b) => uVal(b) - uVal(a));
  const plan = [];
  for (const m of desc) {
    const v = uVal(m);
    const n = Math.floor(remU / v);
    remU -= n * v;
    plan.push({ _id: m._id, "system.quantity.value": n });
  }
  if (remU !== 0) return false; // nie da się dokładnie rozmienić → ochrona kasy (nic nie pobieramy)
  await actor.updateEmbeddedDocuments("Item", plan);
  return true;
}
