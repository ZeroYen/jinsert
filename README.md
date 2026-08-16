# Jinset

Add your own CSS and JavaScript to any website. Snippets are scoped by URL,
survive navigation inside single page apps, and can put themselves back when a
site tears them out.

No build step, no account, no network calls. Clone it, load it, use it.

Built by David Kamaly ([zeroyen](https://github.com/zeroyen)) and released
under the MIT license.

## What it does

- **CSS and JavaScript snippets** per site, or for every site at once.
- **No flash of unstyled page.** CSS lands before the first paint.
- **Survives single page app navigation.** Snippets run again when the route
  changes, without a reload.
- **Keep alive.** An optional per snippet watchdog puts your work back when the
  page removes it. Off by default, because watching the whole document is not
  free.
- **Live updates.** Editing CSS changes every matching tab as you type. No
  reload needed.
- **Export and import** as plain JSON, so your snippets are yours.
- **Works on sites with a strict Content Security Policy**, which normally block
  injected scripts.

## Install

The extension is not on the Chrome Web Store yet, so load it directly:

1. Download or clone this repository:
   `git clone https://github.com/zeroyen/jinset.git`
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top right.
4. Click **Load unpacked** and pick the folder you just downloaded.

That is all. The manager opens on first install.

Chrome 102 or newer is required.

## Using it

Click the toolbar icon to see the snippets that run on the current site. Each
one has a switch. Click a snippet name, or the **Manage** button, to open the
full editor in a tab.

### Creating a snippet

Press **New snippet**, give it a name, then pick where it runs with the
**Apply to** dropdown:

| Choice | Matches |
|---|---|
| This site | Only `github.com` |
| This site and subdomains | `github.com` and `gist.github.com` |
| This exact page | One specific URL |
| All sites | Every page you visit |
| Custom pattern | Anything you type, using Chrome match patterns |

Global snippets run before site specific ones, so a site snippet can override
something you set globally.

### Run at

| Setting | When it runs | Good for |
|---|---|---|
| Document start | Before the page draws anything | CSS, and JavaScript that needs to patch `fetch` or similar before the site uses it |
| DOM ready | Once the HTML is parsed | Most DOM work |
| After load | Once images and scripts have finished | Anything that needs the finished page |

CSS defaults to document start so there is no flash. JavaScript defaults to
after load, which is what most snippets want.

### Keep alive

Some sites rebuild parts of the page and delete anything you added. Turn on
**Keep alive** and Jinset will run your snippet again when that happens.

For this to work, tell it which elements to watch:

```js
const button = document.createElement('button');
button.textContent = 'My button';
jinset.keep(button);            // watch this one
document.querySelector('.toolbar').append(button);
```

Leave Keep alive off unless you need it. It watches the whole document, which
costs something on a busy page.

### Helpers

Every JavaScript snippet gets a `jinset` object:

| Helper | What it does |
|---|---|
| `jinset.keep(element)` | Marks an element so Keep alive can restore it. Returns the element. |
| `jinset.once(key)` | Returns `false` if this already ran on this view. Use it to avoid building the same thing twice. |
| `jinset.gone(key)` | Clears a `once` marker so the next run rebuilds. |
| `jinset.id` | The snippet's own id. |

A snippet that adds one button and does not want duplicates:

```js
if (!jinset.once('my-button')) return;

const button = document.createElement('button');
button.textContent = 'Hello';
jinset.keep(button);
document.body.append(button);
```

### Errors

If a snippet throws, the error is recorded and shown next to the snippet, both
in the manager and as a red dot in the sidebar. One broken snippet never stops
the others from running, and it never breaks the page.

## How it works

Four parts, each with one job:

| File | Job |
|---|---|
| `lib/storage.js` | The only code that touches `chrome.storage`. Owns the schema, export, and import. |
| `lib/match.js` | Matches URLs against patterns. Pure functions, no browser needed. |
| `content/injector.js` | Runs on every page. Owns timing, route changes, and the Keep alive watchdog. |
| `background.js` | Decides which snippets match, performs the injection, keeps open tabs in step. |

Snippets live in `chrome.storage.local`, one record each, grouped by pattern
when the UI needs it.

### The Content Security Policy problem

Manifest V3 blocks every way of turning a string into code. `eval` and
`new Function` are unavailable in the service worker, in content scripts, and in
the page. That makes running user supplied code genuinely awkward.

Jinset carries your snippet into the page as a plain string argument to a
fixed function, which puts it in a `<script>` element. Most sites run it without
complaint.

Sites that send a strict `Content-Security-Policy` header block that script
element. For those, a `declarativeNetRequest` rule removes the CSP header. The
rule is scoped to the sites you actually have a JavaScript snippet for, so every
other site keeps its policy intact.

## Security

Read this part.

Snippets run **in the page context, with the same privileges as the site
itself**. A snippet on your bank's website can read anything on that page,
including whatever you have typed into it. This is not a flaw, it is the point
of the tool, and every extension in this category works the same way.

What that means for you:

- **Only paste code you understand.** Treat a snippet from a forum the way you
  would treat a script you were asked to run in the console, because it is the
  same thing.
- **Prefer narrow patterns.** A snippet scoped to one site cannot touch the
  rest of your browsing. `All sites` is convenient and rarely what you want.
- **The CSP header is removed on sites where you have a JavaScript snippet.**
  That weakens one of the site's defences while you are on it. Keep those
  snippets scoped to sites where you accept that trade.

The extension makes no network requests, sends no telemetry, and stores
everything locally.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keeps your snippets |
| `scripting` | Injects CSS and JavaScript |
| `tabs`, `activeTab` | Finds the current site and updates open tabs |
| `webNavigation` | Notices page loads and single page app route changes |
| `declarativeNetRequestWithHostAccess` | Removes CSP headers on sites where you have a JavaScript snippet |
| `<all_urls>` | Snippets can target any site you choose |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The reasoning behind the architecture,
including the decisions that were tried and rejected, is in
[docs/DESIGN.md](docs/DESIGN.md).

## Credits

Jinset is built and maintained by **David Kamaly**, on GitHub as
[zeroyen](https://github.com/zeroyen).

The editor is [CodeMirror 6](https://codemirror.net) by Marijn Haverbeke and
contributors, vendored as a built file and MIT licensed. Its license is in
`vendor/codemirror/LICENSE`.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 David Kamaly.
