/** Case-preserving diacritics fold: "IČO" -> "ICO". */
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}
