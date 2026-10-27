import market from "../../config/market.json";

export interface SkillDef {
  name: string;
  match: string[];
}

export interface MarketConfig {
  currentRate: number;
  eurCzk: number;
  usdCzk: number;
  gbpCzk: number;
  hoursPerMonth: number;
  hoursPerYear: number;
  skills: SkillDef[];
}

/** The user's current rate (CZK/h) is private: it comes from `CURRENT_RATE` in `.env`, never from git. 0 = unknown. */
const currentRate = Number(process.env.CURRENT_RATE ?? "");

export const marketConfig: MarketConfig = { ...market, currentRate: Number.isFinite(currentRate) && currentRate > 0 ? currentRate : 0 };
