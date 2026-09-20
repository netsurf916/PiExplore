const SEED_MANIFEST_URL = 'data/manifest.json';

const DEFAULT_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

const canvas = document.getElementById('piCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const visualizer = document.getElementById('visualizer');
const startInput = document.getElementById('startInput');
const widthInput = document.getElementById('widthInput');
const controls = document.getElementById('controls');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const statusEl = document.getElementById('status');
const rangeEl = document.getElementById('range');
const emptyState = document.getElementById('emptyState');
const paletteEl = document.getElementById('palette');
const resetPalette = document.getElementById('resetPalette');

const magnifier = document.getElementById('magnifier');
const magnifierCanvas = document.getElementById('magnifierCanvas');
const mctx = magnifierCanvas.getContext('2d');
const magnifierIndex = document.getElementById('magnifierIndex');
const magnifierDigit = document.getElementById('magnifierDigit');

let palette = [...DEFAULT_PALETTE];
let digits = '';
let startIndex = 0n;
let rowWidth = 100;
let rows = 1;
let cellWidth = 1;
let cellHeight = 1;
let renderToken = 0;

let seedManifestPromise = null;
const seedChunkMemory = new Map();

function loadPalette() {
  try {
    const saved = JSON.parse(localStorage.getItem('piExplorePalette'));
    if (Array.isArray(saved) && saved.length === 10) palette = saved;
  } catch {}
}

function savePalette() {
  localStorage.setItem('piExplorePalette', JSON.stringify(palette));
}

function buildPaletteUI() {
  paletteEl.replaceChildren();
  palette.forEach((color, digit) => {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.style.background = color;
    label.title = `Digit ${digit}`;

    const input = document.createElement('input');
    input.type = 'color';
    input.value = color;
    input.setAttribute('aria-label', `Color for digit ${digit}`);
    input.addEventListener('input', () => {
      palette[digit] = input.value;
      label.style.background = input.value;
      savePalette();
      draw();
    });

    const text = document.createElement('span');
    text.textContent = digit;
    label.append(input, text);
    paletteEl.append(label);
  });
}

function parseNonNegativeBigInt(value) {
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) throw new Error('Start index must be a non-negative integer.');
  return BigInt(s);
}

function getGeometry() {
  const rect = visualizer.getBoundingClientRect();
  rowWidth = Math.max(1, Math.min(2000, Number(widthInput.value) || 100));
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height));
  cellWidth = cssWidth / rowWidth;
  rows = Math.max(1, Math.ceil(cssHeight / Math.max(cellWidth, 0.25)));
  cellHeight = cssHeight / rows;
  return { cssWidth, cssHeight, count: rowWidth * rows };
}

function resizeCanvas(cssWidth, cssHeight) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function loadSeedManifest() {
  if (!seedManifestPromise) {
    seedManifestPromise = (async () => {
      const response = await fetch(SEED_MANIFEST_URL, { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(`Local π manifest returned HTTP ${response.status}`);
      }

      const manifest = await response.json();
      if (!manifest || !Number.isInteger(manifest.totalDigits) ||
          !Number.isInteger(manifest.chunkSize) || !Array.isArray(manifest.chunks)) {
        throw new Error('Local π manifest is invalid.');
      }
      return manifest;
    })();
  }
  return seedManifestPromise;
}

async function loadSeedChunk(manifest, chunkIndex, token, stats) {
  if (token !== renderToken) throw new DOMException('superseded', 'AbortError');

  const meta = manifest.chunks[chunkIndex];
  if (!meta) throw new Error('Missing local π chunk metadata.');

  if (seedChunkMemory.has(chunkIndex)) {
    stats.memoryHits++;
    return seedChunkMemory.get(chunkIndex);
  }

  const response = await fetch(`data/${meta.file}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Local π data returned HTTP ${response.status}`);

  const content = (await response.text()).trim();
  if (content.length !== meta.count || !/^\d+$/.test(content)) {
    throw new Error(`Local π data chunk ${meta.file} is invalid.`);
  }

  seedChunkMemory.set(chunkIndex, content);
  stats.filesLoaded++;
  return content;
}

async function fetchDigits(start, count, token) {
  const manifest = await loadSeedManifest();
  const corpusEnd = BigInt(manifest.totalDigits);

  if (start >= corpusEnd) {
    throw new Error(
      `Start index is outside the local corpus. Available indices: 0–${(corpusEnd - 1n).toString()}.`
    );
  }

  const requestedEnd = start + BigInt(count);
  const end = requestedEnd < corpusEnd ? requestedEnd : corpusEnd;
  const chunkSize = BigInt(manifest.chunkSize);
  const parts = [];
  const stats = { filesLoaded: 0, memoryHits: 0 };

  let position = start;
  while (position < end) {
    if (token !== renderToken) throw new DOMException('superseded', 'AbortError');

    const chunkIndex = Number(position / chunkSize);
    const chunkStart = BigInt(chunkIndex) * chunkSize;
    const content = await loadSeedChunk(manifest, chunkIndex, token, stats);
    const offset = Number(position - chunkStart);
    const remaining = Number(end - position);
    const take = Math.min(content.length - offset, remaining);

    if (take <= 0) throw new Error('Local π corpus could not satisfy the requested range.');

    parts.push(content.slice(offset, offset + take));
    position += BigInt(take);
  }

  return {
    content: parts.join(''),
    stats,
    totalDigits: manifest.totalDigits,
    truncated: requestedEnd > corpusEnd
  };
}

function describeSources(result) {
  const parts = [`local corpus: ${result.totalDigits.toLocaleString()} digits`];
  if (result.stats.filesLoaded) {
    parts.push(`${result.stats.filesLoaded} file${result.stats.filesLoaded === 1 ? '' : 's'} loaded`);
  }
  if (result.stats.memoryHits) {
    parts.push(`${result.stats.memoryHits} memory hit${result.stats.memoryHits === 1 ? '' : 's'}`);
  }
  if (result.truncated) parts.push('reached end of corpus');
  return parts.join(' · ');
}

function draw() {
  const { cssWidth, cssHeight } = getGeometry();
  resizeCanvas(cssWidth, cssHeight);

  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  for (let i = 0; i < digits.length; i++) {
    const col = i % rowWidth;
    const row = Math.floor(i / rowWidth);
    if (row >= rows) break;
    const digit = digits.charCodeAt(i) - 48;
    ctx.fillStyle = palette[digit] || '#000';
    const x0 = Math.floor(col * cellWidth);
    const y0 = Math.floor(row * cellHeight);
    const x1 = Math.ceil((col + 1) * cellWidth);
    const y1 = Math.ceil((row + 1) * cellHeight);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

async function render() {
  let start;
  try {
    start = parseNonNegativeBigInt(startInput.value);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }

  const width = Math.max(1, Math.min(2000, Number(widthInput.value) || 100));
  widthInput.value = width;
  rowWidth = width;
  startIndex = start;

  const { cssWidth, cssHeight, count } = getGeometry();
  resizeCanvas(cssWidth, cssHeight);
  emptyState.hidden = false;
  emptyState.textContent = 'Loading digits of π…';
  statusEl.textContent = `Loading ${count.toLocaleString()} digits…`;

  const token = ++renderToken;
  try {
    const result = await fetchDigits(start, count, token);
    if (token !== renderToken) return;

    digits = result.content;
    draw();
    emptyState.hidden = true;

    const end = digits.length ? start + BigInt(digits.length - 1) : start;
    statusEl.textContent =
      `${rowWidth.toLocaleString()} digits/row × ${rows.toLocaleString()} rows · ` +
      `${digits.length.toLocaleString()} digits · ${describeSources(result)}`;
    rangeEl.textContent = `indices ${start.toString()}–${end.toString()}`;
    syncUrl();
  } catch (err) {
    if (err.name === 'AbortError') return;
    digits = '';
    draw();
    emptyState.hidden = false;
    emptyState.textContent = 'Unable to load local π digits.';
    statusEl.textContent = err.message || 'Unable to load digits.';
  }
}

function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set('start', startIndex.toString());
  url.searchParams.set('width', String(rowWidth));
  history.replaceState(null, '', url);
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  if (params.has('start') && /^\d+$/.test(params.get('start'))) startInput.value = params.get('start');
  if (params.has('width')) {
    const width = Number(params.get('width'));
    if (Number.isInteger(width) && width >= 1 && width <= 2000) widthInput.value = width;
  }
}

function movePage(direction) {
  const pageSize = BigInt(Math.max(1, rowWidth * rows));
  let start = parseNonNegativeBigInt(startInput.value);
  start += BigInt(direction) * pageSize;
  if (start < 0n) start = 0n;
  startInput.value = start.toString();
  render();
}

function pointerCell(event) {
  const rect = canvas.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX >= rect.right ||
      event.clientY < rect.top || event.clientY >= rect.bottom) return null;

  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const col = Math.floor(x / cellWidth);
  const row = Math.floor(y / cellHeight);
  const local = row * rowWidth + col;
  if (col < 0 || col >= rowWidth || row < 0 || row >= rows || local >= digits.length) return null;
  return { col, row, local };
}

function drawMagnifier(center) {
  const cols = 11;
  const rowsAround = 7;
  const box = 28;
  const gridW = cols * box;
  const gridH = rowsAround * box;
  const ox = Math.floor((magnifierCanvas.width - gridW) / 2);
  const oy = Math.floor((magnifierCanvas.height - gridH) / 2);

  mctx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
  mctx.fillStyle = '#090c12';
  mctx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);

  const halfCols = Math.floor(cols / 2);
  const halfRows = Math.floor(rowsAround / 2);

  for (let dy = -halfRows; dy <= halfRows; dy++) {
    for (let dx = -halfCols; dx <= halfCols; dx++) {
      const col = center.col + dx;
      const row = center.row + dy;
      const i = row * rowWidth + col;
      const px = ox + (dx + halfCols) * box;
      const py = oy + (dy + halfRows) * box;

      if (col < 0 || col >= rowWidth || row < 0 || row >= rows || i < 0 || i >= digits.length) {
        mctx.fillStyle = '#111722';
        mctx.fillRect(px, py, box, box);
        continue;
      }

      const digit = digits.charCodeAt(i) - 48;
      mctx.fillStyle = palette[digit];
      mctx.fillRect(px, py, box, box);

      mctx.strokeStyle = dx === 0 && dy === 0 ? '#ffffff' : 'rgba(255,255,255,.16)';
      mctx.lineWidth = dx === 0 && dy === 0 ? 2 : 1;
      mctx.strokeRect(px + .5, py + .5, box - 1, box - 1);

      mctx.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      mctx.textAlign = 'center';
      mctx.textBaseline = 'middle';
      mctx.fillStyle = '#ffffff';
      mctx.shadowColor = 'rgba(0,0,0,.9)';
      mctx.shadowBlur = 4;
      mctx.fillText(String(digit), px + box / 2, py + box / 2);
      mctx.shadowBlur = 0;
    }
  }
}

function positionMagnifier(event) {
  const pad = 14;
  const w = magnifier.offsetWidth;
  const h = magnifier.offsetHeight;
  let left = event.clientX + 18;
  let top = event.clientY + 18;

  if (left + w + pad > window.innerWidth) left = event.clientX - w - 18;
  if (top + h + pad > window.innerHeight) top = event.clientY - h - 18;

  magnifier.style.left = Math.max(pad, left) + 'px';
  magnifier.style.top = Math.max(pad, top) + 'px';
}

canvas.addEventListener('mousemove', event => {
  const cell = pointerCell(event);
  if (!cell) {
    magnifier.hidden = true;
    return;
  }

  const digit = digits[cell.local];
  const absolute = startIndex + BigInt(cell.local);
  magnifierIndex.textContent = `index ${absolute.toString()}`;
  magnifierDigit.textContent = `digit ${digit}`;
  drawMagnifier(cell);
  magnifier.hidden = false;
  positionMagnifier(event);
});

canvas.addEventListener('mouseleave', () => {
  magnifier.hidden = true;
});

controls.addEventListener('submit', event => {
  event.preventDefault();
  render();
});
prevButton.addEventListener('click', () => movePage(-1));
nextButton.addEventListener('click', () => movePage(1));

resetPalette.addEventListener('click', () => {
  palette = [...DEFAULT_PALETTE];
  savePalette();
  buildPaletteUI();
  draw();
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
}).observe(visualizer);

loadPalette();
buildPaletteUI();
loadUrlState();
render();
