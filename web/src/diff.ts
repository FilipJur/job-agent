/** Line diff (LCS over lines) for the profile-proposal view. */

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

export interface DiffGap {
  kind: "gap";
  /** Number of unchanged lines hidden by the gap. */
  count: number;
}

export type CollapsedLine = DiffLine | DiffGap;

/** Unchanged lines kept on each side of a collapsed run. */
export const DIFF_CONTEXT = 2;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** LCS-based line diff of `before` → `after`. Changed lines surface as del + add pairs. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i]![j] = a[i] === b[j] ? (len[i + 1]![j + 1] ?? 0) + 1 : Math.max(len[i + 1]![j] ?? 0, len[i]![j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if ((len[i + 1]![j] ?? 0) >= (len[i]![j + 1] ?? 0)) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: a[i]! });
    i++;
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j]! });
    j++;
  }
  return out;
}

/** Long runs of unchanged lines collapse to a gap, keeping `context` lines on each side. */
export function collapseDiff(lines: DiffLine[], context = DIFF_CONTEXT): CollapsedLine[] {
  const out: CollapsedLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind !== "same") {
      out.push(line);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.kind === "same") j++;
    const run = j - i;
    if (run > 2 * context + 1) {
      out.push(...lines.slice(i, i + context), { kind: "gap", count: run - 2 * context }, ...lines.slice(j - context, j));
    } else {
      out.push(...lines.slice(i, j));
    }
    i = j;
  }
  return out;
}

export function gapText(count: number): string {
  if (count <= 4) return `… ${count} řádky beze změny`;
  return `… ${count} řádků beze změny`;
}
