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
- Community translations live in `src/renderer/locales/`. Add a new locale file and register it in `src/renderer/i18n.tsx`.
- Packaged releases can check GitHub Releases for updates automatically, download them in the background, and install on restart.
- Every merge to `main` can publish Early Access installers through `.github/workflows/ea-release.yml` after CI passes.
- Stable tags publish installers through `.github/workflows/release.yml` after CI passes. Switch between Stable and Early Access update channels in `Settings > Updates`.
- Pull requests and pushes to `main` run checks through `.github/workflows/ci.yml`.
- Undo is blocked when current renamed files are missing, restore targets are occupied, or older batches overlap with newer undo-ready batches.

## Releases and code signing

- GitHub Actions builds unsigned artifacts for macOS, Windows, and Linux.
- macOS auto-update installation requires a Developer ID-signed build. Unsigned or ad hoc-signed macOS builds fall back to manual download from GitHub Releases.
- Windows portable builds can check for updates but must also be downloaded manually from GitHub Releases.
- Linux builds are distributed as AppImage/deb artifacts without an auto-update installer.
