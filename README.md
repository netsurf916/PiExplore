# PiExplore

A static GitHub Pages explorer for visualizing the decimal digits of π as color.

## Features

- Index 0 is the leading `3` in π.
- Adjustable starting index.
- Adjustable row width to reframe the same digit stream into different 2D patterns.
- Ten editable colors, one for each decimal digit.
- Canvas rendering sized to the browser viewport.
- Mouse-over magnifier showing nearby colored cells, digits, and the absolute π index.
- Previous/next navigation by one visible page of digits.
- URL parameters preserve the current `start` and `width`.
- Palette is saved in browser local storage.

## Data source

The browser fetches decimal digits from the public [pi.delivery](https://pi.delivery/) API. Requests are chunked into groups of 1,000 digits.

## GitHub Pages

The site is plain HTML/CSS/JavaScript and can be served directly from the repository root on the `main` branch.

In GitHub, enable **Settings → Pages → Deploy from a branch**, then choose **main** and **/(root)**.

## Local use

Serve the repository with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
