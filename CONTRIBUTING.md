# Contributing

Contributions are welcome — bug fixes, features, and fidelity improvements toward
authentic v83 behavior are all appreciated.

## Hard rule: no game assets

**Pull requests must not contain any Nexon-owned content.** This includes:

- `.wz` files or converted WZ JSON (the `wz_client/` data)
- Sprites, images, audio, or fonts extracted from MapleStory
- Dumps of official client data in any format

PRs containing any of the above will be closed without merging, no matter how
convenient they'd make setup. This project stays publishable because it ships
**zero** game assets — every user supplies their own legally obtained v83 files
(see the README). Don't break that.

Screenshots in issues/PR descriptions to demonstrate a bug or fix are fine.

## Licensing

This project is AGPL-3.0 (see [LICENSE](LICENSE)). By submitting a pull request
you agree to license your contribution under the same terms. Keep the existing
OdinMS copyright headers on the script files intact.

## Guidelines

- Follow the code style in [CLAUDE.md](CLAUDE.md) (2-space indent, semicolons,
  single quotes, PascalCase classes / camelCase members)
- Render UI from WZ assets only — no custom HTML/CSS overlays, no hand-drawn
  canvas panels
- Authenticity first: when in doubt, match GMS v83 behavior, not private-server
  conventions
