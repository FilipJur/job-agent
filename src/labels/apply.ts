import { foldDiacritics } from "../text";
import { LABEL_RULES, type LabelRule, type RuleField } from "./rules";

export type LabelInput = Record<RuleField, string>;

/** Labels are independent: every rule is evaluated on its own. */
export function applyRules(input: LabelInput, rules: LabelRule[] = LABEL_RULES): string[] {
  const folded: LabelInput = {
    title: foldDiacritics(input.title),
    description: foldDiacritics(input.description),
    tags: foldDiacritics(input.tags),
    city: foldDiacritics(input.city),
  };
  return rules
    .filter((rule) => rule.matchers.some((m) => m.fields.some((f) => m.pattern.test(folded[f]))))
    .map((rule) => rule.label);
}
