# Vendored CodeMirror 6

`editor.js` is a pre-built bundle. It is committed on purpose so that cloning
this repository and loading it as an unpacked extension needs no build step and
no npm install.

## What is in it

| Package | Version |
|---|---|
| codemirror | 6.0.2 |
| @codemirror/lang-css | 6.3.1 |
| @codemirror/lang-javascript | 6.2.5 |
| @codemirror/theme-one-dark | 6.1.3 |

Bundled with esbuild 0.28.2, ESM output, target chrome102, minified.

## Exported API

The bundle exposes one function so the rest of the extension never touches
CodeMirror internals:

```js
import { createEditor } from '../vendor/codemirror/editor.js';

const editor = createEditor({ parent, doc, type, onChange });
editor.getValue();
editor.setValue(text);
editor.setLanguage('js');   // or 'css'
editor.setDark(true);
editor.focus();
editor.destroy();
```

## Rebuilding

The build source lives in `DO-NOT-UPLOAD/cm-build/` and is not part of the
published repository. To bump the CodeMirror version, restore that folder, run
`npm install`, then `node build.mjs`. The output lands here.

## License

CodeMirror is MIT licensed. The license text is in `LICENSE` in this folder.
