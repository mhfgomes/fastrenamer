# Changelog

## 0.2.0

Changes since 0.1.1.

### Safer renaming and undo

- Rename only the approved, current preview; stale previews and changed plans require a refresh before execution.
- Validate destination paths and refuse to overwrite existing entries. Journal rename operations, roll back failed batches, and recover interrupted operations on startup.
- Check file fingerprints before undo and prevent overlapping rename or undo operations.
- Harden history storage with transactional writes, corruption detection, and recovery notices.
- Upgrade the bundled `@fastrenamer/rename-engine` to 0.2.0.

### Interface and performance

- Move preview planning to a worker thread and virtualize large preview lists.
- Preserve consecutive rule edits and source selections when a picker is cancelled; fix numeric inputs and rules-panel resizing.
- Rename saved presets without replacing their rules, and surface preset, preview, rename, undo, and update errors.
- Bundle fonts locally for reliable offline display.
- Improve keyboard navigation, focus handling, and accessible labels.
- Complete UI translations and add locale-aware plural messages with a single language registry.

### Security and distribution

- Harden Electron navigation, IPC sender validation, Content Security Policy, and runtime fuses.
- Prevent update downgrades and re-check availability when switching between Stable and Early Access.
- Verify that all platform assets are present before publishing releases and avoid duplicate stable release builds.
- Add Linux `.deb` packages alongside AppImage downloads.

### Installation notes

- Releases include unsigned macOS, Windows, and Linux artifacts. macOS auto-update installation requires a Developer ID-signed build; unsigned or ad hoc-signed builds use manual downloads.
- Windows portable builds and Linux builds use manual downloads from GitHub Releases.

[Full comparison](https://github.com/mhfgomes/fastrenamer/compare/v0.1.1...v0.2.0)
