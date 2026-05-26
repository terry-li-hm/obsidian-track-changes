import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  InstallError,
  executeInstall,
  makeInstallPlan,
  parseArgs,
} from "../scripts/install-to-vault.mjs";

async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  -", name);
  } catch (err) {
    console.error("  FAIL -", name);
    console.error(err);
    process.exitCode = 1;
  }
}

async function makeTempRepoAndVault() {
  const root = await mkdtemp(join(tmpdir(), "track-changes-install-"));
  const repo = join(root, "repo");
  const vault = join(root, "vault");
  await mkdir(repo, { recursive: true });
  await mkdir(join(vault, ".obsidian"), { recursive: true });
  for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
    await writeFile(join(repo, artifact), `${artifact}\n`);
  }
  return { root, repo, vault };
}

console.log("install-to-vault:");

await test("parseArgs defaults to dry run", () => {
  const parsed = parseArgs(["/tmp/example-vault"]);
  assert.equal(parsed.help, false);
  assert.equal(parsed.vaultPath, "/tmp/example-vault");
  assert.equal(parsed.apply, false);
});

await test("parseArgs recognises apply and review acknowledgement", () => {
  const parsed = parseArgs([
    "/tmp/example-vault",
    "--apply",
    "--allow-chromatin-reviewed",
  ]);
  assert.equal(parsed.apply, true);
  assert.equal(parsed.allowChromatinReviewed, true);
});

await test("makeInstallPlan rejects relative vault paths", async () => {
  await assert.rejects(
    () => makeInstallPlan({ repoRoot: "/tmp/repo", vaultPath: "relative-vault" }),
    /absolute/,
  );
});

await test("dry run validates artifacts without copying", async () => {
  const { root, repo, vault } = await makeTempRepoAndVault();
  try {
    const plan = await makeInstallPlan({ repoRoot: repo, vaultPath: vault });
    assert.equal(plan.mode, "dry-run");
    assert.equal(plan.artifacts.length, 3);
    assert.equal(existsSync(join(vault, ".obsidian", "plugins", "track-changes")), false);
    await executeInstall(plan);
    assert.equal(existsSync(join(vault, ".obsidian", "plugins", "track-changes")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("apply copies the three plugin artifacts", async () => {
  const { root, repo, vault } = await makeTempRepoAndVault();
  try {
    const plan = await makeInstallPlan({ repoRoot: repo, vaultPath: vault, apply: true });
    await executeInstall(plan);
    for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
      assert.equal(
        await readFile(join(vault, ".obsidian", "plugins", "track-changes", artifact), "utf8"),
        `${artifact}\n`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("apply to Chromatin requires explicit reviewed acknowledgement", async () => {
  if (!existsSync("/Users/terry/chromatin/.obsidian")) return;
  await assert.rejects(
    () => makeInstallPlan({
      repoRoot: "/Users/terry/lab/obsidian-track-changes-roughdraft",
      vaultPath: "/Users/terry/chromatin",
      apply: true,
    }),
    (error) => error instanceof InstallError && /Chromatin/.test(error.message),
  );
});

console.log("done.");
