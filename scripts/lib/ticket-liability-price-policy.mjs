const LOW_OUTLIER_RATIO = 0.7;
const HIGH_OUTLIER_RATIO = 1.5;

export function ticketPriceCategory(ticket) {
  const classType = clean(ticket.classType).toLowerCase();
  const name = clean(ticket.name).toLowerCase();
  const combined = `${classType} ${name}`;
  if (/강사\s*레슨|staff\s*lesson/.test(combined)) return "staff";
  if (/듀엣|세미|semi/.test(combined)) return "duet";
  if (/프라이빗|개인|private|1\s*:\s*1/.test(combined)) return "private";
  if (/그룹|group|회권|주\s*\d+\s*회/.test(combined)) return "group";
  return "other";
}

export function resolveTicketUnitPrice({
  rawUnitPrice,
  referenceUnitPrice,
  rawPriceSource = "",
  paymentType = "",
  status = "",
  profileKind = "",
  explicitFree = false,
}) {
  if (explicitFree) return { unitPrice: 0, priceSource: "무료 보상권", priceQuality: "free" };

  const raw = positive(rawUnitPrice);
  const reference = positive(referenceUnitPrice);
  if (reference != null && shouldUseReference({ raw, reference, rawPriceSource, paymentType, status, profileKind })) {
    return { unitPrice: reference, priceSource: "동일권종 기준가 보정", priceQuality: "adjusted" };
  }
  if (raw != null) {
    return {
      unitPrice: raw,
      priceSource: rawPriceSource === "purchase_aggregate" ? "결제이력 합산" : "현재 실결제",
      priceQuality: "confirmed",
    };
  }
  if (reference != null) return { unitPrice: reference, priceSource: "동일권종 기준가", priceQuality: "estimated" };
  return { unitPrice: null, priceSource: "산정불가", priceQuality: "unavailable" };
}

export function summarizeUnitPriceAverage(tickets, category) {
  const categoryTickets = tickets.filter((ticket) => ticket.priceCategory === category);
  const pricedTickets = categoryTickets.filter((ticket) => ticket.unitPrice > 0 && ticket.denominator > 0);
  const purchasedSessionCount = pricedTickets.reduce((sum, ticket) => sum + ticket.denominator, 0);
  const estimatedPurchaseValue = pricedTickets.reduce((sum, ticket) => sum + ticket.unitPrice * ticket.denominator, 0);
  return {
    averageUnitPrice: purchasedSessionCount > 0 ? Math.round(estimatedPurchaseValue / purchasedSessionCount) : null,
    pricedTicketRows: pricedTickets.length,
    purchasedSessionCount: round1(purchasedSessionCount),
    estimatedPurchaseValue: Math.round(estimatedPurchaseValue),
    adjustedPriceRows: pricedTickets.filter((ticket) => ticket.priceQuality === "adjusted").length,
    estimatedPriceRows: pricedTickets.filter((ticket) => ticket.priceQuality === "estimated").length,
    zeroPriceExcludedRows: categoryTickets.filter((ticket) => ticket.unitPrice === 0).length,
    unavailablePriceExcludedRows: categoryTickets.filter((ticket) => ticket.unitPrice == null || !(ticket.denominator > 0)).length,
  };
}

function shouldUseReference({ raw, reference, rawPriceSource, paymentType, status, profileKind }) {
  if (profileKind === "reservation_only") return true;
  if (raw == null) return true;
  if (rawPriceSource !== "purchase_aggregate" && /미수금/.test(clean(paymentType))) return true;
  if (/사용\s*예정/.test(clean(status)) && raw < reference * 0.9) return true;
  return raw < reference * LOW_OUTLIER_RATIO || raw > reference * HIGH_OUTLIER_RATIO;
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
