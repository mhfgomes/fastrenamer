# Fast Renamer

Fast Renamer is a desktop batch-renaming utility built with Bun, Electron, React, TypeScript, Tailwind, and `shadcn/ui`.

## Features

Fast Renamer focuses on safe, desktop-style bulk renaming with a live preview and reusable rule stacks.

- Single-workspace desktop UI
- Live preview with conflict and invalid-name blocking
- Rule stack with drag-and-drop reordering
- Custom Rule beta with safe inline expressions
- Direct file and folder renaming
- Source modes for:
  - picked files
  - picked folders
  - top-level folders
  - subfolders
  - top-level files
  - files recursively
- Natural sorting across preview and source lists
- Saved presets and built-in sample presets
- Rename history with undo safety checks
- Template-based `New Name` rule with clickable tokens

## Development

Install dependencies:

```bash
bun install
```

Run in development:

```bash
bun run electron:dev
```

Run tests:

```bash
bun run test
```

Typecheck:

```bash
bun run typecheck
```

Build:

```bash
bun run build
```

The rename planning logic is also available as the independently buildable
[`@fastrenamer/rename-engine`](https://www.npmjs.com/package/@fastrenamer/rename-engine) npm package.

Run the built app:

```bash
bun run start
```

## Notes

- UI preferences such as theme and panel width persist across restarts.
- UI language now persists across restarts and can be changed from `Settings > Appearance`.
- Community translations live in `src/renderer/locales/`. See [Translations](#translations) for how to add a language.
- Packaged releases can check GitHub Releases for updates automatically, download them in the background, and install on restart.
- Early Access checks `main` every three hours (at 00:17, 03:17, … UTC) through `.github/workflows/ea-release.yml`. If the commit differs from the last published EA and CI has passed, it publishes one release containing all changes since that EA. Unchanged commits skip the release; failed builds can be retried on the next run. You can also use **Run workflow** on `main` to run the same check manually.
- Stable tags publish installers through `.github/workflows/release.yml` after CI passes. Switch between Stable and Early Access update channels in `Settings > Updates`.
- Switching channels never downgrades. If you move from Early Access to Stable while running an Early Access build newer than the latest stable release, you stay on that build until a newer stable release ships, then update normally. To go back to an older stable version immediately, download and install it manually from GitHub Releases.
- Pull requests and pushes to `main` run checks through `.github/workflows/ci.yml`.
- Undo is blocked when current renamed files are missing, restore targets are occupied, or older batches overlap with newer undo-ready batches.

## Translations

Community translations live in `src/renderer/locales/`. `en.ts` is the source of truth: every
other locale must define exactly the same keys, with the same `{placeholders}`.

To add a language (for example Dutch, `nl`):

1. Copy `src/renderer/locales/en.ts` to `src/renderer/locales/nl.ts`, rename the export to `nl`,
   type it as `LocaleDict` and translate every value:

   ```ts
   import type { LocaleDict } from './en';

   export const nl: LocaleDict = {
     'topbar.add': 'Toevoegen',
     // ...every key from en.ts
   };
   ```

2. Register it in `LOCALE_REGISTRY` in `src/renderer/i18n.tsx`:

   ```ts
   nl: { dict: nl, label: 'Dutch', nativeLabel: 'Nederlands', navigatorPrefixes: ['nl'] },
   ```

   That entry is the only registration needed. The `AppLocale` type, the language picker, the
   stored-language check and system-language detection are all derived from it.
   `navigatorPrefixes` are matched against the OS/browser language (`nl` matches `nl`, `nl-NL`,
   `nl-BE`, ...). The locale code itself always matches, and when several locales match, the
   longest prefix wins (so a `pt-BR` entry would take precedence over `pt` for Brazilian users).

3. Run `bun run typecheck` and `bun run test`. They fail if the new locale is missing a key, has
   an extra key, or uses different placeholders than `en.ts`.

Message format:

- `{name}` is replaced with the value passed in `t('key', { name })`. Keep placeholders exactly
  as they appear in `en.ts`, and don't translate product names (Fast Renamer, GitHub, Electron)
  or code identifiers.
- Count-dependent messages are split into plural variants: `key.one` and `key.other`. Calling
  `t('key', { count })` picks the right form for the active language using `Intl.PluralRules`
  (with `.other` as the fallback). Translate both variants, even if they are identical in your
  language. If your language has more plural forms, also add `key.zero`, `key.two`, `key.few` or
  `key.many` as needed; no other keys may be added.

## Releases and code signing

Release notes are maintained in [CHANGELOG.md](CHANGELOG.md).

To prepare a stable release, update the version in `package.json`, add its changelog
entry, and run the same checks as CI:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
node --test scripts/*.test.mjs
bun run build
```

After merging the release preparation into `main`, tag that commit with the matching
version and push the tag. For 0.2.0:

```bash
git tag -a v0.2.0 -m "Fast Renamer v0.2.0"
git push origin v0.2.0
```

The tag push runs CI. Once it passes, the Release workflow creates a draft, builds
all three platforms, verifies their assets, and publishes the release. GitHub
generates the release notes automatically; the changelog contains the curated notes.

- GitHub Actions builds unsigned artifacts for macOS, Windows, and Linux.
- macOS auto-update installation requires a Developer ID-signed build. Unsigned or ad hoc-signed macOS builds fall back to manual download from GitHub Releases.
- Windows portable builds can check for updates but must also be downloaded manually from GitHub Releases.
- Linux builds are distributed as AppImage/deb artifacts without an auto-update installer.
