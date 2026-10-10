// Single source for the Reference page and the intake form's validation rules.

export const REGIONS = [
  { code: "NA-E", name: "North America, East" },
  { code: "NA-W", name: "North America, West" },
  { code: "LATAM", name: "Latin America" },
  { code: "EU-N", name: "Northern Europe" },
  { code: "EU-S", name: "Southern Europe" },
  { code: "MEA", name: "Middle East & Africa" },
  { code: "APAC-1", name: "Asia Pacific (Japan, Korea, Australia, New Zealand)" },
  { code: "APAC-2", name: "Asia Pacific (rest of region)" },
] as const;

export const PLANS = [
  { id: "starter", name: "Starter", rule: "Team size 1–10." },
  { id: "team", name: "Team", rule: "Team size 2–250." },
  { id: "enterprise", name: "Enterprise", rule: "Team size 50 or more, and the Security interest must be selected." },
] as const;

export const ROLES = ["Engineering", "Operations", "Finance", "Sales", "Other"] as const;

export const INTERESTS = ["Analytics", "Automation", "Security", "Integrations"] as const;
