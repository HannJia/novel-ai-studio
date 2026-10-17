# Release Preferences

- Daily development, cross-computer sync, and automatic backups use the private
  `HannJia/novel-ai-studio-dev` repository (`origin`). These requests are source-only
  and do not authorize a version bump, packaging, or public release.
- The existing public `HannJia/novel-ai-studio` repository is named `public` locally
  and remains the destination for formal releases and application updates.
  Keep `build.publish` and client update URLs pointed at that public repository.
- Explicitly select `public` when pushing formal release commits/tags and
  `HannJia/novel-ai-studio` when creating GitHub Releases. Never publish backup
  branches or use `--all` / `--mirror` when pushing to the public repository.
- Cross-computer setup and backup behavior are documented in
  `docs/development-sync.md`.

- When the user asks to update or upload this project to GitHub, default to a
  complete release: commit and push the source, increment the semantic patch
  version by one (for example, 1.0.4 to 1.0.5), build the Windows x64 installer,
  and publish it with release notes and matching update metadata.
- Follow any more specific instruction from the user instead, such as source
  only, no packaging, or a specified version.
- Ordinary implementation, investigation, and testing requests do not authorize
  packaging or publishing by themselves.
- Verify tests, build, packaged startup, installer contents, and update metadata
  before publishing. Upload to a draft release first and only publish once all
  required assets are verified.
- Never upload local API keys, account credentials, invitations, SSH keys,
  databases, manuscripts, uploaded PDFs, or OCR output/cache. Do not overwrite
  user data to test installation.
- The release workflow and user-facing update behavior are documented in
  `docs/auto-update.md`.
