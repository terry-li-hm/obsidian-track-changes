#!/usr/bin/env node

import { existsSync } from "node:fs";
import { cp, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, "..");
const artifacts = ["main.js", "manifest.json", "styles.css"];
const chromatinVault = "/Users/terry/chromatin";

export class InstallError extends Error {}

export function parseArgs(argv) {
  const args = [...argv];
  const flags = new Set();
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith("--")) flags.add(arg);
    else positional.push(arg);
  }

  if (flags.has("--help") || positional.length !== 1) {
    return { help: true };
  }

  return {
    help: false,
    vaultPath: positional[0],
    apply: flags.has("--apply"),
    allowChromatinReviewed:
      flags.has("--allow-chromatin-reviewed") ||
      process.env.TRACK_CHANGES_CHROMATIN_REVIEWED === "1",
  };
}

export function usage() {
  return [
    "Usage: node scripts/install-to-vault.mjs /absolute/path/to/vault [--apply]",
    "",
    "Default mode is a dry run. It prints the target plugin directory and",
    "artifact list without copying files.",
    "",
    "Chromatin guard:",
    "  Applying to /Users/terry/chromatin requires --allow-chromatin-reviewed",
    "  or TRACK_CHANGES_CHROMATIN_REVIEWED=1.",
  ].join("\n");
}

export async function makeInstallPlan({
  repoRoot = defaultRepoRoot,
  vaultPath,
  apply = false,
  allowChromatinReviewed = false,
} = {}) {
  if (!vaultPath) throw new InstallError("Missing vault path.");
  if (!isAbsolute(vaultPath)) {
    throw new InstallError("Vault path must be absolute.");
  }

  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedVault = resolve(vaultPath);
  const vaultStat = await stat(resolvedVault).catch(() => null);
  if (!vaultStat?.isDirectory()) {
    throw new InstallError(`Vault directory does not exist: ${resolvedVault}`);
  }

  const obsidianDir = join(resolvedVault, ".obsidian");
  const obsidianStat = await stat(obsidianDir).catch(() => null);
  if (!obsidianStat?.isDirectory()) {
    throw new InstallError(`Not an Obsidian vault: missing ${obsidianDir}`);
  }

  const resolvedChromatin = await realpath(chromatinVault).catch(() => resolve(chromatinVault));
  const realVault = await realpath(resolvedVault).catch(() => resolvedVault);
  const isChromatin = realVault === resolvedChromatin;
  if (apply && isChromatin && !allowChromatinReviewed) {
    throw new InstallError(
      "Refusing live Chromatin install without --allow-chromatin-reviewed.",
    );
  }

  const artifactPaths = artifacts.map((artifact) => ({
    name: artifact,
    source: join(resolvedRepoRoot, artifact),
    target: join(obsidianDir, "plugins", "track-changes", artifact),
  }));

  const missing = artifactPaths.filter((artifact) => !existsSync(artifact.source));
  if (missing.length > 0) {
    throw new InstallError(
      `Missing build artifact(s): ${missing.map((artifact) => artifact.name).join(", ")}`,
    );
  }

  return {
    mode: apply ? "apply" : "dry-run",
    vaultPath: resolvedVault,
    pluginDir: join(obsidianDir, "plugins", "track-changes"),
    isChromatin,
    artifacts: artifactPaths,
  };
}

export async function executeInstall(plan) {
  if (plan.mode !== "apply") return plan;

  await mkdir(plan.pluginDir, { recursive: true });
  for (const artifact of plan.artifacts) {
    await cp(artifact.source, artifact.target);
  }
  return plan;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exitCode = 0;
    return;
  }

  const plan = await makeInstallPlan(parsed);
  await executeInstall(plan);
  console.log(JSON.stringify({
    ok: true,
    mode: plan.mode,
    vaultPath: plan.vaultPath,
    pluginDir: plan.pluginDir,
    isChromatin: plan.isChromatin,
    artifacts: plan.artifacts.map((artifact) => artifact.name),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof InstallError ? error.message : error);
    process.exitCode = 1;
  });
}
