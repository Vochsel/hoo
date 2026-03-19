---
name: release
description: Bump version, commit, tag, and push to trigger a new desktop release build.
disable-model-invocation: true
argument-hint: [patch|minor|major]
allowed-tools: Bash(git *), Bash(gh *), Read, Edit, Grep, Glob
---

# Release

Create a new versioned release of the Hoo desktop app.

## Usage

```
/release          # patch bump (default)
/release patch    # 0.1.24 → 0.1.25
/release minor    # 0.1.24 → 0.2.0
/release major    # 0.1.24 → 1.0.0
```

## Steps

1. **Preflight checks**
   - Verify working tree is clean (`git status`). If there are uncommitted changes, stop and tell the user.
   - Verify current branch is `main`.
   - Verify remote is reachable.

2. **Determine new version**
   - Read current version from `apps/desktop/package.json`.
   - Find the highest existing `v*` git tag with `git tag -l 'v*' | sort -V | tail -1` to avoid collisions.
   - Bump according to `$ARGUMENTS[0]` (default: `patch`) using semver rules.
   - The new version MUST be higher than both the current `package.json` version AND the highest existing tag.

3. **Update version**
   - Edit the `"version"` field in `apps/desktop/package.json` to the new version.
   - Commit: `chore: bump version to X.Y.Z`

4. **Tag and push**
   - Create tag: `git tag vX.Y.Z`
   - Push commits: `git push`
   - Push tag: `git push origin vX.Y.Z`

5. **Verify**
   - Run `gh run list --limit 1` to confirm the Build Desktop workflow was triggered.
   - Print a summary: old version, new version, tag name, and link to the Actions run.

## Important

- The version in `apps/desktop/package.json` MUST match the tag. electron-builder uses it for the `latest-mac.yml` version field, and `electron-updater` compares against it to detect updates.
- Never amend or force-push. If something goes wrong, the user can fix it in a follow-up.
- The GitHub Actions workflow (`.github/workflows/build-desktop.yml`) triggers on `v*` tags and handles building + creating the GitHub release automatically.
