![img](AGlogo.PNG)

# Abstruse-Goose-Archive

In 2023 the awesome website [Abstruse Goose](https://abstrusegoose.com/) went offline.
It hosted at the end around 520 comics.

This repository contains a mirror of the comics that were available on
the website around the time of the shutdown. 
Another archive can still be found on the [Wayback Machine](https://web.archive.org/web/20230326160103/https://abstrusegoose.com/).

I cannot name the original authors as they are not known and the website does not 
contain any contact information.

# License

License copied from the original website.

This work is licensed under the Creative Commons Attribution-NonCommercial 3.0 United States License. To view a copy of this license, visit http://creativecommons.org/licenses/by-nc/3.0/us/ or send a letter to Creative Commons, PO Box 1866, Mountain View, CA 94042, USA.

# Web Viewer

A web viewer for the archive is available at **[danielrozenberg.github.io/Abstruse-Goose-Archive](https://danielrozenberg.github.io/Abstruse-Goose-Archive/)**.

Features: browse by number, keyboard navigation, full-text search across transcripts, and per-comic AI-generated transcripts and visual descriptions.

This repository is a fork of the original archive created by **[s-macke](https://github.com/s-macke/Abstruse-Goose-Archive)**, who did the foundational work of collecting and organising the comics from the Wayback Machine.

The web viewer was built with AI assistance (entirely vibe-coded). Transcripts and visual descriptions for each comic were generated automatically by an AI model and **may contain errors** — contributions and corrections are welcome via pull request.

# Structure

| Path | Contents |
|------|----------|
| `comics/` | Comic strip images (PNG) |
| `data/comics.json` | All comic metadata, transcripts, and visual descriptions |
| `index.html` / `js/app.mjs` / `css/style.css` | The single-page web viewer |
| `sw.mjs` | Service worker for clean-URL routing |
| `scripts/build.mjs` | Regenerates `data/comics.json` from images (requires an Anthropic API key) |
| `scripts/normalize-transcripts.mjs` | Re-normalises and restructures existing transcripts |

# Contributing

To fix a transcript, visual description, or something in the app:

1. Edit `data/comics.json` for content fixes, or the files in `js/`, `css/`, `index.html` for app fixes
2. Open a pull request on GitHub

To regenerate transcripts from scratch:

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...
node scripts/build.mjs          # generates data/comics.json (idempotent)
node scripts/normalize-transcripts.mjs  # re-formats transcripts to structured JSON
```
