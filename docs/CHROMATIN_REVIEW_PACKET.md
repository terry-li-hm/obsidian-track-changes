# Chromatin Review Packet

## Decision

Decide whether to install the `roughdraft-attributes` branch of Track Changes into the live Chromatin Obsidian vault for a fixture-first trial, then later for the Matthew/Simon operating-model draft.

Current branch head for review: run `git log -1 --oneline` in this repository and use that commit.

## What This Enables

- Obsidian-native review panel for Markdown CriticMarkup.
- Durable source-of-truth comments and suggestions in the Markdown file itself.
- Roughdraft attributes immediately after each mark: `id`, `by`, `at`, and `re`.
- Codex/Claude-style reviewer workflow through `docs/SKILL.md` and the installed `criticmarkup-reviewer` skill.
- Repeatable disposable Obsidian smoke test before any live-vault install.

## Evidence To Check

Run from this repository:

```sh
npm test
npm run build
npm run test:obsidian
npm run install:vault -- /Users/terry/chromatin
```

Expected result:

- `npm test` passes parser, operation, finalize, rebase, reading-plan, author, and installer tests.
- `npm run build` produces the Obsidian bundle.
- `npm run test:obsidian` opens only a generated disposable vault under `test/.obsidian-smoke/`, verifies the real Obsidian panel, writes one Roughdraft-attributed reply, and exits cleanly.
- `npm run install:vault -- /Users/terry/chromatin` is dry-run only and reports the target plugin directory without copying files.

## Live Install Command

Only after review approval:

```sh
npm run build
npm run install:vault -- /Users/terry/chromatin --apply --allow-chromatin-reviewed
```

The installer refuses to apply to `/Users/terry/chromatin` unless the review acknowledgement flag is present.

## Acceptance Checklist

- [ ] Parser includes trailing Roughdraft attributes in each node range.
- [ ] Accept, reject, delete, and finalize operations remove attributes with their marks.
- [ ] Reading mode hides Roughdraft attributes outside literal code examples.
- [ ] Panel replies write `id`, `by`, `at`, and `re` metadata.
- [ ] Code blocks and inline code are not parsed as review markup.
- [ ] Agent reviewer skill asks structural questions before local wording comments.
- [ ] Agent reviewer skill replies in existing Roughdraft threads to converge with other agents.
- [ ] Disposable Obsidian smoke passes at the reviewed commit.
- [ ] Live Chromatin install has not happened before approval.

## Rollback

Disable the plugin in Obsidian, then remove `/Users/terry/chromatin/.obsidian/plugins/track-changes/`. The Markdown remains the durable source of truth; Git remains the audit and rollback layer for document changes.

## Known Deferrals

- This does not rewrite the larger Obsidian Proof Bridge.
- This does not sync with the Proof SDK comment store.
- This does not automatically adjudicate agent disagreements without Terry.
- This should be applied to the Matthew/Simon operating-model draft only after the fixture-first live-vault trial is approved.
