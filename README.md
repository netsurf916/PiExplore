# PiExplore

A static GitHub Pages explorer for visualizing the decimal digits of π as color.

## Features

- Index 0 is the leading `3` in π.
- Adjustable starting index and row width.
- Ten editable colors, one for each decimal digit.
- Canvas rendering sized to the browser viewport.
- Mouse-over magnifier showing nearby colored cells, digits, and absolute π indices.
- Previous/next navigation by one visible page of digits.
- URL parameters preserve the current `start` and `width`.
- Palette is saved in browser local storage.

## Digit data and caching

PiExplore uses a layered data strategy to minimize requests to `pi.delivery`:

1. **First 5,000,000 digits:** published as five 1,000,000-digit static files. These are served by GitHub Pages and can be cached by the browser/CDN.
2. **Beyond 5,000,000:** fetched from the public [pi.delivery](https://pi.delivery/) API in its 1,000-digit chunks.
3. **Persistent fallback cache:** API responses are stored in the browser Cache Storage API, so revisiting the same range does not need another `pi.delivery` request.
4. **In-memory cache:** seed and API chunks already used during the current page session are reused without another read.

## Verifying the bundled 5-million-digit corpus

The repository contains `pi-pari-5m.txt`, generated independently with PARI/GP. It contains exactly 5,000,000 ASCII digits using PiExplore's indexing convention, where index 0 is the leading `3`.

On a cache miss, the GitHub Pages build:

1. validates the PARI file format and exact byte count;
2. independently computes 5,000,000 digits with pinned `mpmath==1.3.0` plus guard digits;
3. compares the **entire 5,000,000-digit streams byte-for-byte**;
4. fails the deployment and reports the first differing index if any digit disagrees;
5. records a SHA-256 for the complete verified corpus and for every deployed 1,000,000-digit chunk in `data/manifest.json`;
6. packages the verified PARI reference into the static seed files.

The verified generated seed is cached by GitHub Actions using a key derived from both `pi-pari-5m.txt` and the verification script, so ordinary site changes do not recompute five million digits. Any change to either the reference corpus or verifier invalidates the cache and forces a complete re-verification.

## GitHub Pages

Pages is deployed by `.github/workflows/pages.yml`. Repository Pages settings should use **GitHub Actions** as the publishing source.

## Local verification/build

```sh
python3 -m pip install mpmath==1.3.0
rm -rf data
python3 tools/generate_pi_seed.py \
  --reference pi-pari-5m.txt \
  --digits 5000000 \
  --chunk-size 1000000 \
  --output-dir data
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
