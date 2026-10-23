# Leaderboard nickname policy

The browser and Worker use `src/ranked/nickname.ts` (Worker re-export).

- Names contain 3–16 displayed grapheme clusters after NFC normalization, trimming and collapsing allowed whitespace to ordinary spaces. Raw input is limited separately to 256 UTF-16 units before processing. Missing, null and blank input still becomes Anonymous.
- Allowed: Unicode letters (`L`), numbers (`N`), combining marks (`M`) attached to preceding letters/numbers/marks, currency symbols (`Sc`), spaces, and exactly `# @ & + % ! ? _ - . ' ‘ ’`. `$` is a currency symbol. Symbols may lead a name, but every name needs at least one letter or number.
- Rejected before whitespace normalization: controls (including tabs/newlines), format characters, surrogate errors, Unicode line/paragraph separators and default-ignorable code points. This excludes bidi overrides/isolates, zero-width joiners and variation selectors. Angle brackets, double quotes, backticks, slashes, backslashes and other unlisted symbols are rejected. Emoji are not in this policy.
- `Intl.Segmenter` provides grapheme counting where available. The fallback groups base characters with following combining marks; complex script counts can differ on older runtimes or across Unicode versions.

Names remain text: Phaser Text paints canvas glyphs; the DOM editor uses input.value and its live status uses textContent. No nickname is inserted as HTML. Filtering is not the rendering defence. Casing is preserved. Leaderboard/result names scale down to their existing column limits; personal-best labels now scale to 1120 game pixels as well.

Font fallback and complex-script shaping depend on browser/OS fonts. Width fitting may make very wide names smaller; excessive stacked diacritics can still exceed typical vertical font metrics. Names needing invisible joining controls are intentionally outside this policy. Physical Android font/IME verification remains manual.

Focused verification:

```powershell
cd phaser-asteroids
npm.cmd exec -- vitest run tests/nickname.test.ts tests/ranked.test.ts server/tests/leaderboard.test.ts server/tests/lifecycle.test.ts
node scripts/nickname-render.mjs
npm.cmd run build
npm.cmd --prefix server run typecheck
```

The canvas check starts a loopback-only Vite on 5191, uses existing Chromium tooling, and checks literal Unicode/punctuation names, width limits and HTML-like response text across all three displays. It does not play games, write scores, or run the legacy regression suite.
