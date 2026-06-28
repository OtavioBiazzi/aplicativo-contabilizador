import type { CashBreakdownItem, CashDetails, DaySummary, LedgerEntry, RoundDirection, SplitDetails } from "./types.js";

export const ROUNDING_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 5];

const DENOMINATIONS = [
  200,
  100,
  50,
  20,
  10,
  5,
  2,
  1,
  0.5,
  0.25,
  0.1,
  0.05
];

export function toCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function parseMoney(input: string | number): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : 0;
  }

  const clean = input
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  return {
    date: date.toLocaleDateString("pt-BR"),
    time: date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  };
}

export function applyRounding(value: number, step: number, direction: RoundDirection): number {
  const safeStep = step > 0 ? step : 0.05;
  const factor = value / safeStep;
  const rounded =
    direction === "up" ? Math.ceil(factor) : direction === "down" ? Math.floor(factor) : Math.round(factor);
  return roundMoney(rounded * safeStep);
}

export function calculateSplit(
  originalValue: number,
  people: number,
  roundingStep: number,
  roundingDirection: RoundDirection,
  registerDifference = true
): SplitDetails {
  const safePeople = Math.max(1, Math.floor(people || 1));
  const perPersonRaw = roundMoney(originalValue / safePeople);
  const perPersonRounded = applyRounding(originalValue / safePeople, roundingStep, roundingDirection);
  const finalTotal = roundMoney(perPersonRounded * safePeople);

  return {
    originalValue: roundMoney(originalValue),
    people: safePeople,
    perPersonRaw,
    roundingStep,
    roundingDirection,
    perPersonRounded,
    finalTotal,
    difference: roundMoney(finalTotal - originalValue),
    registerDifference
  };
}

export function calculateCash(accountValue: number, paidWith: number): CashDetails {
  const accountCents = toCents(accountValue);
  const paidCents = toCents(paidWith);
  let changeCents = Math.max(0, paidCents - accountCents);
  const breakdown: CashBreakdownItem[] = [];

  for (const denomination of DENOMINATIONS) {
    const denominationCents = toCents(denomination);
    const quantity = Math.floor(changeCents / denominationCents);
    if (quantity > 0) {
      breakdown.push({
        label: formatCurrency(denomination),
        value: denomination,
        quantity
      });
      changeCents -= quantity * denominationCents;
    }
  }

  return {
    accountValue: roundMoney(accountValue),
    paidWith: roundMoney(paidWith),
    change: roundMoney(Math.max(0, paidWith - accountValue)),
    breakdown,
    unrepresentedCents: fromCents(changeCents)
  };
}

export function getEntryAmount(entry: LedgerEntry): number {
  if (entry.status !== "active") {
    return 0;
  }
  if (entry.type === "Cancelado/Estorno") {
    return -Math.abs(entry.finalValue);
  }
  return entry.finalValue;
}

export function summarizeEntries(entries: LedgerEntry[]): DaySummary {
  const active = entries.filter((entry) => entry.status === "active");
  const totals = active.reduce(
    (acc, entry) => {
      const amount = getEntryAmount(entry);
      acc.total += amount;
      acc.count += 1;
      acc.biggestSale = Math.max(acc.biggestSale, amount);
      acc.differenceTotal += entry.difference || 0;
      acc.byType[entry.type] = (acc.byType[entry.type] || 0) + amount;
      acc.byPayment[entry.paymentMethod || "Nao informado"] =
        (acc.byPayment[entry.paymentMethod || "Nao informado"] || 0) + amount;

      if (entry.tableNumber) {
        acc.byTable[entry.tableNumber] = (acc.byTable[entry.tableNumber] || 0) + amount;
      }
      if (entry.busNumber) {
        acc.byBus[entry.busNumber] = (acc.byBus[entry.busNumber] || 0) + amount;
      }
      if (entry.type === "Onibus") {
        acc.busTotal += amount;
      }
      if (entry.paymentMethod === "Dinheiro" || entry.type === "Dinheiro/Troco") {
        acc.cashTotal += amount;
      }
      return acc;
    },
    {
      total: 0,
      count: 0,
      average: 0,
      biggestSale: 0,
      busTotal: 0,
      cashTotal: 0,
      differenceTotal: 0,
      byType: {} as Record<string, number>,
      byTable: {} as Record<string, number>,
      byBus: {} as Record<string, number>,
      byPayment: {} as Record<string, number>
    }
  );

  return {
    ...totals,
    total: roundMoney(totals.total),
    average: totals.count ? roundMoney(totals.total / totals.count) : 0,
    biggestSale: roundMoney(totals.biggestSale),
    busTotal: roundMoney(totals.busTotal),
    cashTotal: roundMoney(totals.cashTotal),
    differenceTotal: roundMoney(totals.differenceTotal)
  };
}
