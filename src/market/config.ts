import market from "../../config/market.json";

export interface SkillDef {
  name: string;
  match: string[];
}

export interface MarketConfig {
  currentRate: number;
  eurCzk: number;
  hoursPerMonth: number;
  hoursPerYear: number;
  skills: SkillDef[];
}

export const marketConfig: MarketConfig = market;
