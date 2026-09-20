# PiExplore

A static GitHub Pages explorer for visualizing the decimal digits of π as color.

## Features

- Index 0 is the leading `3` in π.
- Adjustable starting index and row width.
- Multiple rendering modes: digit palette, 1-digit intensity, 2-digit intensity, 3-digit RGB, 6-digit RRGGBB, and absolute digit difference.
- Red, green, or blue channel selection for the intensity and difference modes.
- Ten editable colors for digit-palette mode.
- Canvas rendering sized to the browser viewport.
- Mouse-over magnifier showing nearby colored cells, source digits, interpreted values/colors, and absolute π indices.
- Granular navigation by one row, ten rows, half a page, or a whole page, plus a jump back to index 0.
- URL parameters preserve the current `start`, `width`, `mode`, and `channel`.
- Palette is saved in browser local storage.
- All displayed π digits come from this repository; the browser does not call a third-party digit service.

## Local 50-million-digit corpus

The repository contains `pi-pari-50m.txt.gz`, a 50,000,000-digit corpus generated with PARI/GP. PiExplore indexes it with the leading `3` at index 0, so the locally available range is:

```
0 .. 49,999,999
```

The repository also retains `pi-pari-5m.txt`. Those first 5,000,000 digits were independently regenerated with pinned `mpmath==1.3.0` and previously verified byte-for-byte against PARI/GP.

The Pages build does **not calculate π** and does not download π data from anywhere. It only:

1. checks the gzip container integrity;
2. decompresses the checked-in 50M corpus;
3. verifies it contains exactly 50,000,000 ASCII decimal digits;
4. compares its entire first 5,000,000 digits byte-for-byte against the independently verified 5M corpus;
5. splits the 50M corpus into fifty 1,000,000-digit static files;
6. records SHA-256 hashes for the complete uncompressed corpus, compressed source, and each static chunk in `data/manifest.json`;
7. deploys those static files with the app.

This means ordinary exploration makes requests only to the GitHub Pages site itself. There is no `pi.delivery` fallback. Requests beyond index 49,999,999 are rejected locally.

## Caching

The browser requests only the 1M-digit static chunks needed for the current view. Loaded chunks are retained in memory for the current session, and requests use normal browser/GitHub Pages HTTP caching across reloads.

## GitHub Pages

Pages is deployed by `.github/workflows/pages.yml`. Repository Pages settings should use **GitHub Actions** as the publishing source.

## Local build

No third-party Python package is required:

```sh
rm -rf _site
mkdir -p _site/data
python3 tools/package_pi_corpus.py \
  --corpus pi-pari-50m.txt.gz \
  --verified-prefix pi-pari-5m.txt \
  --digits 50000000 \
  --chunk-size 1000000 \
  --output-dir _site/data
cp index.html app.js styles.css .nojekyll _site/
python3 -m http.server 8000 --directory _site
```

Then open `http://localhost:8000`.
