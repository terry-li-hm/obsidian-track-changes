import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTs(rel) {
  const out = await build({
    entryPoints: [resolve(__dirname, rel)],
    bundle: true,
    format: "esm",
    target: "es2018",
    write: false,
    platform: "neutral",
  });
  const code = out.outputFiles[0].text;
  return await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

const ops = await loadTs("../src/operations.ts");
const parserMod = await loadTs("../src/parser.ts");
const { parse } = parserMod;
const {
  applyEdits,
  acceptAddition,
  rejectAddition,
  acceptDeletion,
  rejectDeletion,
  acceptSubstitution,
  rejectSubstitution,
  appendReply,
  validateReplyText,
  deleteCommentNode,
  deleteThread,
  removeHighlight,
  finalizeEdits,
  DEFAULT_FINALIZE,
} = ops;

function test(name, fn) {
  try {
    fn();
    console.log("  ok  -", name);
  } catch (err) {
    console.error("  FAIL -", name);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("operations:");

test("acceptAddition keeps the text", () => {
  const src = "x {++ins++} y";
  const r = parse(src);
  const out = applyEdits(src, [acceptAddition(r.nodes[0])]);
  assert.equal(out, "x ins y");
});

test("rejectAddition removes the block", () => {
  const src = "x {++ins++} y";
  const r = parse(src);
  const out = applyEdits(src, [rejectAddition(r.nodes[0])]);
  assert.equal(out, "x  y");
});

test("acceptDeletion removes the block", () => {
  const src = "x {--gone--} y";
  const r = parse(src);
  const out = applyEdits(src, [acceptDeletion(r.nodes[0])]);
  assert.equal(out, "x  y");
});

test("rejectDeletion keeps the text", () => {
  const src = "x {--gone--} y";
  const r = parse(src);
  const out = applyEdits(src, [rejectDeletion(r.nodes[0])]);
  assert.equal(out, "x gone y");
});

test("acceptSubstitution uses new text", () => {
  const src = "x {~~old~>new~~} y";
  const r = parse(src);
  const out = applyEdits(src, [acceptSubstitution(r.nodes[0])]);
  assert.equal(out, "x new y");
});

test("rejectSubstitution keeps old text", () => {
  const src = "x {~~old~>new~~} y";
  const r = parse(src);
  const out = applyEdits(src, [rejectSubstitution(r.nodes[0])]);
  assert.equal(out, "x old y");
});

test("removeHighlight strips the wrapper and keeps the text", () => {
  const src = "x {==look here==} y";
  const r = parse(src);
  const out = applyEdits(src, [removeHighlight(r.nodes[0])]);
  assert.equal(out, "x look here y");
});

test("accept/reject operations remove trailing Roughdraft attributes with the mark", () => {
  const cases = [
    ['x {++ins++}{id="a1" by="Codex"} y', acceptAddition, "x ins y"],
    ['x {++ins++}{id="a1" by="Codex"} y', rejectAddition, "x  y"],
    ['x {--gone--}{id="d1" by="Codex"} y', acceptDeletion, "x  y"],
    ['x {--gone--}{id="d1" by="Codex"} y', rejectDeletion, "x gone y"],
    ['x {~~old~>new~~}{id="s1" by="Codex"} y', acceptSubstitution, "x new y"],
    ['x {~~old~>new~~}{id="s1" by="Codex"} y', rejectSubstitution, "x old y"],
    ['x {==look here==}{id="h1" by="Codex"} y', removeHighlight, "x look here y"],
  ];

  for (const [src, op, expected] of cases) {
    const r = parse(src);
    const out = applyEdits(src, [op(r.nodes[0])]);
    assert.equal(out, expected);
  }
});

test("deleteCommentNode removes one message of a thread", () => {
  const src = "x {>>Claude: a<<}{>>done<<} y";
  const r = parse(src);
  const out = applyEdits(src, [deleteCommentNode(r.nodes[1])]);
  assert.equal(out, "x {>>Claude: a<<} y");
});

test("deleteCommentNode removes a Roughdraft-attributed comment and its attributes", () => {
  const src = 'x {>>Claude: a<<}{id="c1" by="Claude"} y';
  const r = parse(src);
  const out = applyEdits(src, [deleteCommentNode(r.nodes[0])]);
  assert.equal(out, "x  y");
});

test("deleteThread removes all messages", () => {
  const src = "x {>>Claude: a<<}{>>done<<} y";
  const r = parse(src);
  const out = applyEdits(src, [deleteThread(src, r.threads[0])]);
  assert.equal(out, "x  y");
});

test("deleteThread removes all Roughdraft-attributed replies without orphan metadata", () => {
  const src = 'x {>>Claude: a<<}{id="c1" by="Claude"}{>>Codex: b<<}{id="c2" by="Codex" re="c1"} y';
  const r = parse(src);
  const out = applyEdits(src, [deleteThread(src, r.threads[0])]);
  assert.equal(out, "x  y");
});

test("appendReply inserts adjacent without prefix", () => {
  const src = "x {>>Claude: a<<} y";
  const r = parse(src);
  const edit = appendReply(src, r.threads[0], r, "thanks");
  const out = applyEdits(src, [edit]);
  assert.equal(out, "x {>>Claude: a<<}{>>thanks<<} y");
  // and the new structure parses as a single thread with one reply
  const r2 = parse(out);
  assert.equal(r2.threads.length, 1);
  assert.equal(r2.threads[0].replyIndexes.length, 1);
  assert.equal(r2.nodes[1].authorName, null);
});

test("appendReply attaches after the last message of an existing thread", () => {
  const src = "x {>>Claude: a<<}{>>ignore<<} y";
  const r = parse(src);
  const edit = appendReply(src, r.threads[0], r, "actually no");
  const out = applyEdits(src, [edit]);
  assert.equal(out, "x {>>Claude: a<<}{>>ignore<<}{>>actually no<<} y");
});

test("appendReply can write Roughdraft reply metadata", () => {
  const src = 'x {>>Claude: a<<}{id="c1" by="Claude"} y';
  const r = parse(src);
  const edit = appendReply(src, r.threads[0], r, "done", {
    authorName: "Terry",
    timestamp: "2026-05-26T15:51:00.000Z",
  });
  const out = applyEdits(src, [edit]);
  assert.equal(
    out,
    'x {>>Claude: a<<}{id="c1" by="Claude"}{>>done<<}{id="c2" by="Terry" at="2026-05-26T15:51:00.000Z" re="c1"} y',
  );

  const r2 = parse(out);
  assert.equal(r2.threads.length, 1);
  assert.equal(r2.threads[0].replyIndexes.length, 1);
  const reply = r2.nodes[r2.threads[0].replyIndexes[0]];
  assert.equal(reply.authorName, "Terry");
  assert.deepEqual(reply.attributes, {
    id: "c2",
    by: "Terry",
    at: "2026-05-26T15:51:00.000Z",
    re: "c1",
  });
});

test("appendReply chooses the next unused comment id", () => {
  const src = 'x {>>Claude: a<<}{id="c1"}{>>Codex: b<<}{id="c3" re="c1"} y';
  const r = parse(src);
  const edit = appendReply(src, r.threads[0], r, "middle", {
    authorName: "Terry",
    timestamp: "2026-05-26T15:52:00.000Z",
  });
  const out = applyEdits(src, [edit]);
  assert.ok(out.includes('{id="c2" by="Terry" at="2026-05-26T15:52:00.000Z" re="c1"}'));
});

test("appendReply rejects comment closing delimiters in reply text", () => {
  const src = "x {>>Claude: a<<} y";
  const r = parse(src);
  assert.equal(
    validateReplyText("please keep <<} and continue"),
    "Replies cannot contain the CriticMarkup comment closing marker <<}.",
  );
  assert.throws(
    () => appendReply(src, r.threads[0], r, "please keep <<} and continue"),
    /CriticMarkup comment closing marker/,
  );
});

test("applyEdits handles multiple non-overlapping edits", () => {
  const src = "a {++x++} b {--y--} c";
  const r = parse(src);
  const out = applyEdits(src, [acceptAddition(r.nodes[0]), acceptDeletion(r.nodes[1])]);
  assert.equal(out, "a x b  c");
});

test("finalizeEdits with defaults: keep additions, keep original prose", () => {
  const src = "a {++x++} b {--y--} c {~~o~>n~~} d {>>Claude: note<<}";
  const r = parse(src);
  const out = applyEdits(src, finalizeEdits(r, DEFAULT_FINALIZE));
  // default: additions accept, deletions reject (keep), subs reject (keep old), strip comments
  assert.equal(out, "a x b y c o d ");
});

test("finalizeEdits removes Roughdraft attributes for all finalized marks", () => {
  const src = 'a {++x++}{id="a1"} b {--y--}{id="d1"} c {~~o~>n~~}{id="s1"} d {>>Claude: note<<}{id="c1"}';
  const r = parse(src);
  const out = applyEdits(src, finalizeEdits(r, DEFAULT_FINALIZE));
  assert.equal(out, "a x b y c o d ");
});

test("finalizeEdits with accept-all", () => {
  const src = "a {++x++} b {--y--} c {~~o~>n~~} d";
  const r = parse(src);
  const opts = { additions: "accept", deletions: "accept", substitutions: "accept", stripHighlights: true };
  const out = applyEdits(src, finalizeEdits(r, opts));
  assert.equal(out, "a x b  c n d");
});

console.log("done.");
