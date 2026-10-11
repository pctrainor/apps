// Settings shared by the trading-floor runner (scripts/market.ts) and the dashboard (/market).

export const FEE_RATE = 0.006; // charged on every trade, close to Coinbase's entry-level taker fee

export const PERSONAS = [
  {
    name: "user1",
    label: "Cautious saver",
    brief:
      "You hate losing money. You keep most of your money in cash, buy small amounts of BTC only after a dip, and warn others when they take big risks.",
  },
  {
    name: "user2",
    label: "Momentum chaser",
    brief:
      "You buy whatever is rising fastest and get excited when a coin moves. You have strong FOMO and you like to hype your picks to the group.",
  },
  {
    name: "user3",
    label: "Contrarian",
    brief:
      "You distrust hype. You buy what others are selling and sell into excitement. You enjoy disagreeing with user2, politely but firmly.",
  },
  {
    name: "user4",
    label: "Diversifier",
    brief:
      "You want a balanced portfolio across every coin and some cash. You rebalance when one position gets too big, and you explain your allocation in percentages.",
  },
  {
    name: "user5",
    label: "Day trader",
    brief:
      "You trade small amounts often, read short-term moves, take quick profits and cut losses fast. You joke around but you track your profit carefully.",
  },
  {
    name: "user6",
    label: "Long-term believer",
    brief: "You believe in ETH for the long run. You buy steadily, almost never sell, and talk about the long-term picture.",
  },
  {
    name: "user7",
    label: "Newcomer",
    brief:
      "You are new to crypto. You ask the others questions before you trade, trade small, and say what you learned from your trades.",
  },
  {
    name: "user8",
    label: "Risk manager",
    brief:
      "You size every position so no single coin is more than a third of your money. You comment on how much risk the others are taking.",
  },
] as const;

export type Persona = (typeof PERSONAS)[number];

export function personaLabel(name: string): string {
  return PERSONAS.find((p) => p.name === name)?.label ?? "";
}

export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Price formatting that keeps small prices (like DOGE) readable. */
export const price = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 1 ? 5 : 2,
  });

/** Signed dollar change, e.g. +$12.40 or −$3.10. */
export const usdChange = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

export const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
