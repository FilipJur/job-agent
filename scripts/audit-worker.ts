/**
 * Audit one finished worker before review: its diff against the prompt's file set and its omp transcript.
 * Usage: bun scripts/audit-worker.ts <task>   (task = prompt name; run record from scripts/spawn-worker.sh)
 * Prints a markdown summary; exit 1 when a red flag is found. Docs: docs/LEAD.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const task = process.argv[2];
if (!task) {
  console.error("usage: bun scripts/audit-worker.ts <task>");
  process.exit(2);
}
const repo = join(import.meta.dir, "..");
const run = Object.fromEntries(
  readFileSync(join(repo, ".lead/runs", `${task}.env`), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const { DIR: dir = "", PROMPT: prompt = "", REPORT: report = "", BRANCH: branch = "", BASE: base = "main" } = run;
const spawnedAt = Number(run.SPAWNED_AT) * 1000;
const flags: string[] = [];
const notes: string[] = [];

// --- File set from the prompt: backticked paths after "Files you may change:" up to "Not allowed"/"Anything else".
const promptText = readFileSync(prompt, "utf8");
const setLine = promptText.slice(promptText.indexOf("Files you may change:")).split("\n")[0] ?? "";
const allowedPart = setLine.split(/Not allowed|Anything else/)[0] ?? "";
const allowed = [...allowedPart.matchAll(/`([^`]+)`/g)]
  .map((m) => m[1] ?? "")
  .filter((p) => p.includes("/") || /\.[a-z]+$/.test(p));
const globToRegex = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`);
const allowedRe = allowed.map(globToRegex);
const isAllowed = (path: string): boolean => allowedRe.some((re) => re.test(path));

// --- Git: changed files (committed on the branch + uncommitted), commits, LOC split.
const git = (...args: string[]): string => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args]);
  return r.stdout.toString().trimEnd();
};
const committed = git("diff", "--name-only", `${base}..${branch}`).split("\n").filter(Boolean);
const uncommitted = git("status", "--porcelain").split("\n").filter(Boolean).map((l) => l.slice(3));
const commits = git("log", "--oneline", `${base}..${branch}`).split("\n").filter(Boolean);
let srcAdded = 0;
let testAdded = 0;
for (const line of git("diff", "--numstat", `${base}..${branch}`).split("\n").filter(Boolean)) {
  const [added = "0", , path = ""] = line.split("\t");
  if (path.startsWith("tests/") && !path.startsWith("tests/fixtures/")) testAdded += Number(added) || 0;
  else if (/^(src|web|scripts)\//.test(path)) srcAdded += Number(added) || 0;
}
const outside = [...new Set([...committed, ...uncommitted])].filter((p) => !isAllowed(p));
if (outside.length > 0) flags.push(`files outside the prompt's set: ${outside.join(", ")}`);
if (uncommitted.length > 0) flags.push(`uncommitted changes: ${uncommitted.join(", ")}`);
if (commits.length === 0) flags.push("no commits on the branch");
if (testAdded > srcAdded) flags.push(`test LOC added ${testAdded} > src LOC added ${srcAdded}`);

// --- Report freshness.
let reportFresh = false;
try {
  reportFresh = statSync(report).mtimeMs >= spawnedAt;
} catch {
  // missing report is flagged below
}
if (!reportFresh) flags.push("no report newer than the spawn");

// --- Transcript: omp stores sessions under ~/.omp/agent/sessions/<cwd relative to $HOME, "/" -> "-">.
const sessionDir = join(homedir(), ".omp/agent/sessions", `-${relative(homedir(), dir).replaceAll("/", "-")}`);
const sessions = readdirSync(sessionDir)
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => join(sessionDir, f))
  .filter((f) => statSync(f).mtimeMs >= spawnedAt && readFileSync(f, "utf8").includes(prompt));
if (sessions.length === 0) flags.push(`no transcript found in ${sessionDir}`);

interface ToolCall {
  type: string;
  name?: string;
  arguments?: Record<string, unknown>;
}
let cost = 0;
let first = Number.POSITIVE_INFINITY;
let last = 0;
const models = new Set<string>();
const errorsByTool = new Map<string, number>();
const suspicious: string[] = [];
const touched = new Set<string>();
const ownWorktree = relative(repo, dir);
for (const file of sessions) {
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    const entry = JSON.parse(raw) as {
      timestamp?: string;
      model?: string;
      message?: { role?: string; model?: string; isError?: boolean; toolName?: string; content?: unknown; usage?: { cost?: { total?: number } } };
    };
    const at = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
    if (!Number.isNaN(at)) {
      first = Math.min(first, at);
      last = Math.max(last, at);
    }
    const msg = entry.message;
    if (!msg) continue;
    if (msg.role === "assistant") {
      cost += msg.usage?.cost?.total ?? 0;
      if (msg.model) models.add(msg.model);
      for (const call of (Array.isArray(msg.content) ? msg.content : []) as ToolCall[]) {
        if (call.type !== "toolCall") continue;
        const args = call.arguments ?? {};
        const command = typeof args.command === "string" ? args.command : "";
        if (command) {
          const sleep = /\bsleep\s+(\d+)/.exec(command);
          if (sleep && Number(sleep[1]) >= 10) suspicious.push(`waits: ${command.slice(0, 120)}`);
          if (/\bgit\s+(push|merge|rebase|stash|reset\s+--hard)\b/.test(command)) suspicious.push(`git: ${command.slice(0, 120)}`);
          if (/data\/jobs\.db(?![.\w])/.test(command)) suspicious.push(`production DB: ${command.slice(0, 120)}`);
          for (const m of command.matchAll(/\.worktrees\/([\w.-]+)/g)) {
            if (`.worktrees/${m[1]}` !== ownWorktree) suspicious.push(`other worktree: ${command.slice(0, 120)}`);
          }
        }
        const paths: string[] = [];
        if ((call.name === "write" || call.name === "edit") && typeof args.path === "string") paths.push(args.path);
        if (call.name === "edit" && typeof args.input === "string") {
          for (const m of args.input.matchAll(/^\[([^\]#]+)#/gm)) paths.push(m[1] ?? "");
        }
        for (const p of paths) {
          if (p.startsWith("/tmp") || p.includes("://") || p === report) continue;
          const rel = isAbsolute(p) ? relative(dir, p) : p;
          if (rel.startsWith("..")) suspicious.push(`edit outside its checkout: ${p}`);
          else touched.add(rel);
        }
      }
    }
    if (msg.role === "toolResult" && msg.isError) {
      errorsByTool.set(msg.toolName ?? "?", (errorsByTool.get(msg.toolName ?? "?") ?? 0) + 1);
    }
  }
}
const editedOutside = [...touched].filter((p) => !isAllowed(p));
if (editedOutside.length > 0) flags.push(`edited outside the set (maybe reverted): ${editedOutside.join(", ")}`);
if (suspicious.length > 0) flags.push(`${suspicious.length} suspicious commands (below)`);

const minutes = last > first ? Math.round((last - first) / 60000) : 0;
notes.push(`branch \`${branch}\`, ${commits.length} commits, ${committed.length} files changed`);
notes.push(`LOC added: src ${srcAdded}, tests ${testAdded}`);
notes.push(`transcript: ${sessions.length} session(s), ${minutes} min, models ${[...models].join(", ") || "?"}, cost $${cost.toFixed(2)}`);
notes.push(`tool errors: ${[...errorsByTool].map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`);
notes.push(`allowed set: ${allowed.join(", ")}`);

console.log(`# Audit ${task}\n`);
console.log(flags.length === 0 ? "**No red flags.**\n" : `**Red flags:**\n${flags.map((f) => `- ${f}`).join("\n")}\n`);
console.log(notes.map((n) => `- ${n}`).join("\n"));
if (suspicious.length > 0) console.log(`\nSuspicious commands:\n${[...new Set(suspicious)].map((s) => `- ${s}`).join("\n")}`);
process.exit(flags.length === 0 ? 0 : 1);
