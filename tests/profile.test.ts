import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfile, writeProfile } from "../src/profile";

const dir = mkdtempSync(join(tmpdir(), "job-agent-profile-"));
const previous = process.env.PROFILE_PATH;
process.env.PROFILE_PATH = join(dir, "nested", "profile.md");

afterAll(() => {
  if (previous === undefined) delete process.env.PROFILE_PATH;
  else process.env.PROFILE_PATH = previous;
  rmSync(dir, { recursive: true, force: true });
});

test("a missing profile is created from the template; writeProfile round-trips", () => {
  expect(existsSync(process.env.PROFILE_PATH!)).toBe(false);
  expect(readProfile()).toBe(readFileSync(join(import.meta.dir, "..", "profile.md"), "utf8"));
  expect(existsSync(process.env.PROFILE_PATH!)).toBe(true);

  writeProfile("# moje\n");
  expect(readProfile()).toBe("# moje\n");
});
