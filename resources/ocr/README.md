# Local OCR Model Assets

This directory contains the manifest and Apache-2.0 license for the pinned
`tesseract-ocr/tessdata_best` Simplified Chinese and English LSTM models.
`manifest.json` records the upstream commit and SHA-256 of each model.

Run `npm run prepare:ocr` to fetch the exact files. The script tries the official
raw GitHub URL and the same pinned commit on jsDelivr, verifies SHA-256, and
refuses corrupt or oversized responses. Model binaries are ignored by Git.

Vite serves the local resources during development and copies them into
`dist/ocr-assets` when building. The OCR core and worker are supplied by the
locked `tesseract.js` and `tesseract.js-core` dependencies, with their notices.
Runtime recognition does not download models or transmit page images.

These models produce recognition hypotheses, not guaranteed-correct text.
The source page remains the evidence. See `docs/ocr-import.md`.
