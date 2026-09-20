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

1. **First 5,000,000 digits:** generated during the GitHub Pages Action and published as five 1,000,000-digit static files. These are served by GitHub Pages and can be cached by the browser/CDN.
2. **Beyond 5,000,000:** fetched from the public [pi.delivery](https://pi.delivery/) API in its 1,000-digit chunks.
3. **Persistent fallback cache:** API responses are stored in the browser Cache Storage API, so revisiting the same range does not need another `pi.delivery` request.
4. **In-memory cache:** seed and API chunks already used during the current page session are reused without another read.

The deployment generates the static seed with `mpmath==1.3.0`, verifies the standard leading digits, and checks the 1,000,000th fractional-digit boundary against a published reference checkpoint. Each generated static chunk also gets a SHA-256 value in `data/manifest.json`.

The generated seed is cached by GitHub Actions, keyed to the generator script, so normal site changes do not recompute five million digits on every deployment.

## GitHub Pages

Pages is deployed by `.github/workflows/pages.yml`. Repository Pages settings should use **GitHub Actions** as the publishing source.

## Local use

The repository itself does not contain the generated `data/` directory. For a local build:

```sh
python3 -m pip install mpmath==1.3.0
mkdir -p data
python3 tools/generate_pi_seed.py --digits 5000000 --chunk-size 1000000 --output-dir data
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
