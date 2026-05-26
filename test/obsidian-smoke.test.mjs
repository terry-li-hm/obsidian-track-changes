// Optional runtime smoke test for the Obsidian plugin.
//
// This launches Obsidian against a disposable vault and user-data profile,
// enables only the locally built Track Changes plugin, opens a fixture note,
// verifies the review panel, writes a reply through the actual panel UI, and
// then tears down the isolated Obsidian process. It does not touch any live
// vault.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const smokeRoot = resolve(
  process.env.OBSIDIAN_SMOKE_ROOT ?? join(repoRoot, "test", ".obsidian-smoke"),
);
const vaultDir = join(smokeRoot, "vault");
const profileDir = join(smokeRoot, "profile");
const fixtureName = "Roughdraft Review Fixture.md";
const vaultId = "trackchangessmoke";
const pluginId = "track-changes";
const obsidianBin =
  process.env.OBSIDIAN_BIN ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const replyText = "Obsidian smoke reply";

if (typeof WebSocket === "undefined") {
  throw new Error("This smoke test requires a Node runtime with global WebSocket support.");
}

async function main() {
  assert.ok(existsSync(obsidianBin), `Obsidian binary not found: ${obsidianBin}`);
  for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
    assert.ok(
      existsSync(join(repoRoot, artifact)),
      `Missing ${artifact}; run npm run build before npm run test:obsidian.`,
    );
  }

  await prepareSmokeVault();
  const port = Number(process.env.OBSIDIAN_SMOKE_PORT) || await findFreePort();
  const child = spawn(
    obsidianBin,
    [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`],
    {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    const page = await waitForPage(port);
    const client = await connectDevtools(page.webSocketDebuggerUrl);
    try {
      await waitForEval(client, "Boolean(window.app?.workspace && window.app?.plugins)");
      await ensurePluginLoaded(client);

      const summary = await openFixtureAndPanel(client);
      assert.equal(summary.activeFile, fixtureName);
      assert.equal(summary.pluginLoaded, true);
      assert.equal(summary.panelCards, 5);
      assert.match(summary.panelText, /Codex/);
      assert.match(summary.panelText, /Claude/);
      assert.match(summary.panelText, /INSERT/);
      assert.match(summary.panelText, /DELETE/);
      assert.match(summary.panelText, /REPLACE/);
      assert.equal(summary.visibleMetadataHidden, true);
      assert.equal(summary.literalCodeStillVisible, true);

      const reply = await writePanelReply(client);
      assert.equal(reply.hasReply, true);
      assert.match(reply.fragment, /\{>>Obsidian smoke reply<<\}/);
      assert.match(reply.fragment, /id="c3"/);
      assert.match(reply.fragment, /by="You"/);
      assert.match(reply.fragment, /at="[^"]+Z"/);
      assert.match(reply.fragment, /re="c1"/);

      await saveScreenshot(client);
      console.log("Obsidian smoke test passed.");
      console.log(`  vault: ${vaultDir}`);
      console.log(`  reply: ${reply.fragment}`);
    } finally {
      client.close();
    }
  } catch (error) {
    console.error(output.trim());
    throw error;
  } finally {
    await terminateProcessGroup(child);
  }
}

async function prepareSmokeVault() {
  await rm(smokeRoot, { recursive: true, force: true });
  const pluginDir = join(vaultDir, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDir, { recursive: true });
  for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
    await cp(join(repoRoot, artifact), join(pluginDir, artifact));
  }
  await writeFile(
    join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify([pluginId], null, 2),
  );
  await writeFile(
    join(vaultDir, ".obsidian", "app.json"),
    JSON.stringify({ defaultViewMode: "preview", showInlineTitle: false }, null, 2),
  );
  await writeFile(join(vaultDir, fixtureName), fixtureMarkdown());

  await mkdir(profileDir, { recursive: true });
  await writeFile(
    join(profileDir, "obsidian.json"),
    JSON.stringify({
      vaults: {
        [vaultId]: {
          path: vaultDir,
          ts: Date.now(),
          open: true,
        },
      },
      cli: true,
    }),
  );
}

function fixtureMarkdown() {
  return `# Roughdraft Review Fixture

This fixture is safe to use for plugin review. It lives in a disposable vault, not Chromatin.

The assurance model should distinguish operating controls from governance decisions.{>>Codex: This comment should appear as a Codex-authored thread root, with the metadata hidden in reading mode.<<}{id="c1" by="Codex" at="2026-05-26T15:56:00Z"}{>>Claude: The reply should remain adjacent, display as Claude, and keep \`re="c1"\` in source.<<}{id="c2" by="Claude" at="2026-05-26T15:57:00Z" re="c1"}

The document should add {++a short decision log for model exceptions++}{id="a1" by="Codex" at="2026-05-26T15:58:00Z"} and remove {--duplicative approval language--}{id="d1" by="Claude" at="2026-05-26T15:59:00Z"} where it repeats the same control owner.

For publication, {~~proof comments should be accepted manually~>review comments should remain in Markdown until explicitly finalized~~}{id="s1" by="Codex" at="2026-05-26T16:00:00Z"}.

This phrase is {==worth checking in reading mode==}{id="h1" by="Claude" at="2026-05-26T16:01:00Z"} because highlight attributes should not show as raw text.

\`\`\`markdown
Literal examples in code stay untouched: {>>Codex: not a real comment<<}{id="code1" by="Codex"}
\`\`\`
`;
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Obsidian DevTools page: ${lastError?.message ?? ""}`);
}

async function connectDevtools(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression, awaitPromise = false) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (response.result.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails, null, 2));
  }
  return response.result.result.value;
}

async function waitForEval(client, expression) {
  const deadline = Date.now() + 30_000;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression);
    if (lastValue) return;
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for expression: ${expression}; last value: ${JSON.stringify(lastValue)}`,
  );
}

async function ensurePluginLoaded(client) {
  const deadline = Date.now() + 60_000;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await snapshotObsidianState(client, true);
    if (lastState.pluginLoaded) return;
    await delay(lastState.clickedButton ? 1500 : 500);
  }

  throw new Error(
    `Timed out waiting for ${pluginId} to load:\n${JSON.stringify(lastState, null, 2)}`,
  );
}

async function snapshotObsidianState(client, clickTrustButton = false) {
  return await evaluate(client, `
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const buttons = Array.from(document.querySelectorAll('button'));
      let clickedButton = null;
      const pluginLoaded = Boolean(window.app?.plugins?.plugins?.[${JSON.stringify(pluginId)}]);

      if (${JSON.stringify(clickTrustButton)} && !pluginLoaded) {
        const trustedAction = buttons.find((candidate) => {
          const label = normalize(candidate.innerText);
          const lowerLabel = label.toLowerCase();
          return label === 'Trust author and enable plugins' ||
            label === 'Trust this vault' ||
            label === 'Enable plugins' ||
            label === 'Turn off Restricted Mode' ||
            (lowerLabel.includes('trust author') && lowerLabel.includes('enable plugins'));
        });
        if (trustedAction) {
          clickedButton = normalize(trustedAction.innerText);
          trustedAction.click();
        }
      }

      const enabled = window.app?.plugins?.enabledPlugins;
      return {
        title: document.title,
        pluginLoaded: Boolean(window.app?.plugins?.plugins?.[${JSON.stringify(pluginId)}]),
        clickedButton,
        buttons: buttons.map((button) => normalize(button.innerText)).filter(Boolean),
        enabledPlugins: enabled ? Array.from(enabled) : [],
        loadedPlugins: Object.keys(window.app?.plugins?.plugins ?? {}),
        activeFile: window.app?.workspace?.getActiveFile?.()?.path ?? null,
        bodyText: normalize(document.body?.innerText).slice(0, 2000),
      };
    })()
  `);
}

async function openFixtureAndPanel(client) {
  return await evaluate(client, `
    (async () => {
      await app.workspace.openLinkText(${JSON.stringify(fixtureName.replace(/\\.md$/, ""))}, '', false);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      app.commands.executeCommandById('track-changes:open-review-panel');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const bodyText = document.body.innerText;
      return {
        activeFile: app.workspace.getActiveFile()?.path ?? null,
        pluginLoaded: Boolean(app.plugins.plugins[${JSON.stringify(pluginId)}]),
        panelCards: document.querySelectorAll('.tc-card').length,
        panelText: document.querySelector('.tc-panel')?.innerText ?? '',
        visibleMetadataHidden: !bodyText.includes('id="c1"') && !bodyText.includes('id="a1"'),
        literalCodeStillVisible: bodyText.includes('id="code1"'),
      };
    })()
  `, true);
}

async function writePanelReply(client) {
  return await evaluate(client, `
    (async () => {
      const textarea = document.querySelector('.tc-card-thread textarea.tc-reply-input');
      if (!textarea) throw new Error('Missing reply textarea');
      textarea.value = ${JSON.stringify(replyText)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      const button = Array.from(document.querySelectorAll('.tc-card-thread button'))
        .find((candidate) => candidate.innerText.trim() === 'Reply');
      if (!button) throw new Error('Missing Reply button');
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const leaf = app.workspace.getLeavesOfType('markdown')
        .find((candidate) => candidate.view.file?.path === ${JSON.stringify(fixtureName)});
      const source = leaf?.view?.editor?.getValue?.() ?? '';
      const match = source.match(/\\{>>Obsidian smoke reply<<\\}\\{[^}]+\\}/);
      return {
        hasReply: Boolean(match),
        fragment: match?.[0] ?? '',
      };
    })()
  `, true);
}

async function saveScreenshot(client) {
  const screenshotPath = process.env.OBSIDIAN_SMOKE_SCREENSHOT ??
    join(smokeRoot, "obsidian-smoke.png");
  const response = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  if (response.result?.data) {
    await writeFile(screenshotPath, Buffer.from(response.result.data, "base64"));
  }
}

async function terminateProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!processExists(child.pid)) return;
    await delay(250);
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
