# Release Preferences

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
