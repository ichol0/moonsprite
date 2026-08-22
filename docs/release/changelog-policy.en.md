# Complete Changelog Policy

[中文](changelog-policy.md) | English

MoonSprite maintains a long-term change ledger made of a current working section plus versioned archives. Every completed software change must be preserved, but continuous debugging does not update the log item by item. When releasing `dev.X`, audit the complete diff since the cycle baseline and consolidate the entries.

## Scope

The following changes must be recorded:

- New features and extensions to existing features.
- Bug fixes, compatibility fixes, and failure protection.
- Changes to interaction, UI, shortcuts, defaults, and user-facing text.
- Performance improvements and confirmed performance regressions.
- Refactoring that affects future maintenance even when external behavior is unchanged.
- Dependency, build, CI, installation, file-association, and platform-integration changes.

A change may omit a changelog entry when it only edits explanatory text, adds code comments, or corrects test descriptions without changing software, build, or maintenance behavior. Failed attempts, temporary debugging, generated directories, and rejected approaches do not enter the changelog.

## Writing Rules

1. Use one bullet for each independently explainable change. Do not combine unrelated features or bugs into "various improvements."
2. Development does not require an immediate entry for every request. When releasing `dev.X`, audit the complete version diff once, write new records under `## Unreleased` at the top of root `CHANGELOG.md`, and organize them into exactly three categories: Added, Improved, and Fixed. Classify performance, engineering, and maintenance changes as Improved or Fixed according to the final outcome rather than adding peer categories.
3. Describe the result users or maintainers actually receive. Include shortcuts, defaults, compatibility ranges, or migration behavior where necessary.
4. When one problem is corrected multiple times, preserve the final effective conclusion. Never delete facts that have already shipped. Factual wording may be corrected, but the commit message must state why.
5. At release, move every item under Unreleased unchanged into `docs/changelog/<version>.md`, then immediately recreate an empty `## Unreleased`. Never merge or discard items merely to shorten the file.
6. Every archive operation must update the version indexes in the root file and `docs/changelog/README.md`. Archive files remain in the repository permanently.
7. Root `CHANGELOG.md` must not exceed 64 KiB. Archive the current version before approaching the limit; do not let the normal AI entry point grow without bound.

## AI Read Scope

- Ordinary feature work and bug fixes do not need to read the changelog. When preparing a `dev.X` release, read only root `CHANGELOG.md` and the diff since the cycle baseline.
- When tracing one version, read only `docs/changelog/<version>.md`.
- Traverse all of `docs/changelog/` only for a complete history audit. Do not mechanically load every archive for each task.

## Automated Gate

`pnpm check:release` runs `scripts/check-changelog-update.mjs` through `pnpm check:maintenance`; `pnpm check:dev` does not run this gate:

- Release checks inspect software changes in the current worktree.
- Pull Requests compare the target branch with the current branch.
- Pushes to `main` compare commits before and after the push.
- The check fails when source, platform code, build configuration, workflows, or maintenance scripts changed without a matching `CHANGELOG.md` change.
- The check verifies that the root log retains Unreleased and Version Index sections, stays below 64 KiB, and points only to existing archive files.

The automated gate can confirm only that the changelog changed, not that its wording is complete. Before releasing `dev.X`, developers and AI must compare each item against the version diff and ensure nothing is omitted.
