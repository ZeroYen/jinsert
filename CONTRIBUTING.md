# Contributing to Jinset

Thanks for taking a look. This is a small project and the goal is to keep it
that way: lightweight, readable, and working out of the box.

Jinset is maintained by David Kamaly ([zeroyen](https://github.com/zeroyen)).
By contributing you agree that your work is released under the MIT license that
covers the rest of the project.

## Getting set up

There is no build step. Clone the repository, load the folder as an unpacked
extension in `chrome://extensions`, and you are running the code.

After changing a file, press the reload button on the extension card. Changes
to `background.js` need that reload. Changes to the manager or popup only need
you to close and reopen them.

## Project layout

```
manifest.json          extension manifest
background.js          service worker: matching, injection, live updates
content/injector.js    content script: timing, route changes, keep alive
lib/schema.js          snippet shape, defaults, validation
lib/match.js           URL matching against patterns
lib/storage.js         the only module that touches chrome.storage
popup/                 the toolbar popup
manager/               the full editor tab
vendor/codemirror/     pre-built editor bundle, committed on purpose
```

Each part has one job. `lib/schema.js` and `lib/match.js` are pure functions
with no browser dependency, which is what makes them testable under plain Node.

## Guidelines

- **Keep the boundaries.** Only `lib/storage.js` talks to `chrome.storage`. Only
  `content/injector.js` touches the page. Going around either one makes the
  next change harder.
- **No dependencies at runtime.** CodeMirror is vendored as a built file so that
  cloning and loading the extension needs nothing else. Please do not add npm
  packages that ship in the extension.
- **Watch the cost.** This is meant to be light. A change that runs on every
  page, or that observes the whole document, needs a good reason and should be
  opt in.
- **Match the surrounding style.** Two space indent, single quotes, semicolons.
  Comments explain why, not what.

## Tests

Test material lives in `DO-NOT-UPLOAD/` and is not part of the published
repository. If you are working from a fresh clone you will need to set it up:

```bash
mkdir -p DO-NOT-UPLOAD/cm-build
cd DO-NOT-UPLOAD/cm-build
npm init -y
npm install codemirror@6 @codemirror/lang-css @codemirror/lang-javascript \
  @codemirror/theme-one-dark esbuild playwright
npx playwright install chromium
```

Then, from the repository root:

```bash
# Unit tests: patterns, schema, validation. Fast, no browser.
node --test DO-NOT-UPLOAD/tests/match.test.mjs

# Integration tests: loads the real extension into Chromium.
node --test DO-NOT-UPLOAD/tests/integration.test.mjs
```

Both suites should be green before you open a pull request. The integration
tests cover the parts that are easy to break by accident: injection timing,
route changes, the keep alive watchdog, live CSS updates, and sites with a
strict Content Security Policy.

If you fix a bug, add a test that fails without your fix.

## Rebuilding CodeMirror

`vendor/codemirror/editor.js` is generated. To bump the version:

```bash
cd DO-NOT-UPLOAD/cm-build
npm install codemirror@6 @codemirror/lang-css @codemirror/lang-javascript \
  @codemirror/theme-one-dark esbuild
node build.mjs
```

The output lands in `vendor/codemirror/`. Update the version table in
`vendor/codemirror/README.md` to match.

## Pull requests

Explain what the change does and why. If it changes behaviour anyone would
notice, say so plainly. Small focused changes are easier to review and easier to
accept.
