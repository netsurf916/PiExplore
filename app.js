const SEED_MANIFEST_URL = 'data/manifest.json';

const LEGACY_DEFAULT_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

const DEFAULT_PALETTE = [
  '#071b36', '#0b2c5b', '#103e7f', '#1450a3', '#1962c8',
  '#2575e4', '#498ce9', '#6ea3ed', '#92baf2', '#b6d1f6'
];

const DISPLAY_MODES = {
  palette: { label: 'Digit palette', digitsPerPixel: 1, usesChannel: false },
  intensity1: { label: '1-digit intensity', digitsPerPixel: 1, usesChannel: true },
  intensity2: { label: '2-digit intensity', digitsPerPixel: 2, usesChannel: true },
  rgb3: { label: '3-digit RGB', digitsPerPixel: 3, usesChannel: false },
  rgb6: { label: '6-digit RRGGBB', digitsPerPixel: 6, usesChannel: false },
  difference: { label: 'Difference', digitsPerPixel: 1, usesChannel: true }
};

const canvas = document.getElementById('piCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const visualizer = document.getElementById('visualizer');
const startInput = document.getElementById('startInput');
const startDecrement = document.getElementById('startDecrement');
const startIncrement = document.getElementById('startIncrement');
const widthInput = document.getElementById('widthInput');
const widthDecrement = document.getElementById('widthDecrement');
const widthIncrement = document.getElementById('widthIncrement');
const modeSelect = document.getElementById('modeSelect');
const channelField = document.getElementById('channelField');
const channelSelect = document.getElementById('channelSelect');
const controls = document.getElementById('controls');
const homeButton = document.getElementById('homeButton');
const prevButton = document.getElementById('prevButton');
const prevHalfButton = document.getElementById('prevHalfButton');
const prevTenRowsButton = document.getElementById('prevTenRowsButton');
const prevRowButton = document.getElementById('prevRowButton');
const nextRowButton = document.getElementById('nextRowButton');
const nextTenRowsButton = document.getElementById('nextTenRowsButton');
const nextHalfButton = document.getElementById('nextHalfButton');
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
let renderedPixels = 0;

let seedManifestPromise = null;
const seedChunkMemory = new Map();

function loadPalette() {
  try {
    const saved = JSON.parse(localStorage.getItem('piExplorePalette'));
    if (!Array.isArray(saved) || saved.length !== 10) return;

    const isLegacyDefault = saved.every(
      (color, index) => String(color).toLowerCase() === LEGACY_DEFAULT_PALETTE[index]
    );

    if (isLegacyDefault) {
      savePalette();
    } else {
      palette = saved;
    }
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

function getMode() {
  return DISPLAY_MODES[modeSelect.value] || DISPLAY_MODES.palette;
}

function updateModeControls() {
  const enabled = getMode().usesChannel;
  channelSelect.disabled = !enabled;
  channelField.classList.toggle('disabled', !enabled);
}

function scaleToByte(value, maxValue) {
  if (maxValue <= 0) return 0;
  return Math.max(0, Math.min(255, Math.round((value / maxValue) * 255)));
}

function intensityColor(value, maxValue) {
  const byte = scaleToByte(value, maxValue);
  if (channelSelect.value === 'red') return { byte, color: `rgb(${byte}, 0, 0)` };
  if (channelSelect.value === 'green') return { byte, color: `rgb(0, ${byte}, 0)` };
  return { byte, color: `rgb(0, 0, ${byte})` };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function getPixelDescriptor(pixelIndex) {
  const modeName = modeSelect.value;
  const mode = getMode();
  const dpp = mode.digitsPerPixel;
  const sourceOffset = pixelIndex * dpp;

  if (modeName === 'difference') {
    const hasPrefix = startIndex > 0n;
    const currentOffset = pixelIndex + (hasPrefix ? 1 : 0);
    if (currentOffset < 0 || currentOffset >= digits.length) return null;

    const current = digits.charCodeAt(currentOffset) - 48;
    let previous = null;
    let difference = 0;

    if (!(startIndex === 0n && pixelIndex === 0)) {
      const previousOffset = currentOffset - 1;
      if (previousOffset < 0 || previousOffset >= digits.length) return null;
      previous = digits.charCodeAt(previousOffset) - 48;
      difference = Math.abs(current - previous);
    }

    const intensity = intensityColor(difference, 9);
    const source = startIndex + BigInt(pixelIndex);
    const sourceText = previous === null ? String(current) : `${previous}→${current}`;
    return {
      color: intensity.color,
      cellText: String(difference),
      sourceStart: source,
      sourceEnd: source,
      detail: `${sourceText} · Δ ${difference} · ${channelSelect.value} ${intensity.byte}/255`
    };
  }

  if (sourceOffset + dpp > digits.length) return null;

  const chunk = digits.slice(sourceOffset, sourceOffset + dpp);
  const sourceStart = startIndex + BigInt(pixelIndex) * BigInt(dpp);
  const sourceEnd = sourceStart + BigInt(dpp - 1);

  if (modeName === 'palette') {
    const digit = chunk.charCodeAt(0) - 48;
    return {
      color: palette[digit] || '#000',
      cellText: chunk,
      sourceStart,
      sourceEnd,
      detail: `digit ${chunk}`
    };
  }

  if (modeName === 'intensity1') {
    const value = Number(chunk);
    const intensity = intensityColor(value, 9);
    return {
      color: intensity.color,
      cellText: chunk,
      sourceStart,
      sourceEnd,
      detail: `digit ${chunk} · ${channelSelect.value} ${intensity.byte}/255`
    };
  }

  if (modeName === 'intensity2') {
    const value = Number(chunk);
    const intensity = intensityColor(value, 99);
    return {
      color: intensity.color,
      cellText: chunk,
      sourceStart,
      sourceEnd,
      detail: `digits ${chunk} · value ${value} · ${channelSelect.value} ${intensity.byte}/255`
    };
  }

  if (modeName === 'rgb3') {
    const r = scaleToByte(Number(chunk[0]), 9);
    const g = scaleToByte(Number(chunk[1]), 9);
    const b = scaleToByte(Number(chunk[2]), 9);
    return {
      color: `rgb(${r}, ${g}, ${b})`,
      cellText: chunk,
      sourceStart,
      sourceEnd,
      detail: `digits ${chunk} · RGB ${r},${g},${b} · ${rgbToHex(r, g, b)}`
    };
  }

  if (modeName === 'rgb6') {
    const r = scaleToByte(Number(chunk.slice(0, 2)), 99);
    const g = scaleToByte(Number(chunk.slice(2, 4)), 99);
    const b = scaleToByte(Number(chunk.slice(4, 6)), 99);
    return {
      color: `rgb(${r}, ${g}, ${b})`,
      cellText: chunk,
      sourceStart,
      sourceEnd,
      detail: `digits ${chunk} · RGB ${r},${g},${b} · ${rgbToHex(r, g, b)}`
    };
  }

  return null;
}

function countRenderablePixels(maxPixels) {
  if (modeSelect.value === 'difference') {
    const available = startIndex > 0n ? Math.max(0, digits.length - 1) : digits.length;
    return Math.min(maxPixels, available);
  }
  return Math.min(maxPixels, Math.floor(digits.length / getMode().digitsPerPixel));
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

  const pixelCount = rowWidth * rows;
  for (let i = 0; i < pixelCount; i++) {
    const descriptor = getPixelDescriptor(i);
    if (!descriptor) break;

    const col = i % rowWidth;
    const row = Math.floor(i / rowWidth);
    ctx.fillStyle = descriptor.color;
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
  const mode = getMode();
  const visibleSourceDigitsRequested = count * mode.digitsPerPixel;
  let fetchStart = start;
  let fetchCount = visibleSourceDigitsRequested;

  if (modeSelect.value === 'difference' && start > 0n) {
    fetchStart = start - 1n;
    fetchCount += 1;
  }

  resizeCanvas(cssWidth, cssHeight);
  emptyState.hidden = false;
  emptyState.textContent = 'Loading digits of π…';
  statusEl.textContent =
    `Loading ${count.toLocaleString()} pixels from ` +
    `${visibleSourceDigitsRequested.toLocaleString()} π digits…`;

  const token = ++renderToken;
  try {
    const result = await fetchDigits(fetchStart, fetchCount, token);
    if (token !== renderToken) return;

    if (start >= BigInt(result.totalDigits)) {
      throw new Error(
        `Start index is outside the local corpus. Available indices: 0–${(BigInt(result.totalDigits) - 1n).toString()}.`
      );
    }

    digits = result.content;
    renderedPixels = countRenderablePixels(count);
    draw();
    emptyState.hidden = true;

    const visibleSourceDigits = renderedPixels * mode.digitsPerPixel;
    const end = visibleSourceDigits ? start + BigInt(visibleSourceDigits - 1) : start;
    statusEl.textContent =
      `${mode.label} · ${rowWidth.toLocaleString()} pixels/row × ${rows.toLocaleString()} rows · ` +
      `${renderedPixels.toLocaleString()} pixels · ${visibleSourceDigits.toLocaleString()} π digits · ` +
      describeSources(result);
    rangeEl.textContent = `indices ${start.toString()}–${end.toString()}`;
    syncUrl();
  } catch (err) {
    if (err.name === 'AbortError') return;
    digits = '';
    renderedPixels = 0;
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
  url.searchParams.set('mode', modeSelect.value);
  url.searchParams.set('channel', channelSelect.value);
  history.replaceState(null, '', url);
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  if (params.has('start') && /^\d+$/.test(params.get('start'))) startInput.value = params.get('start');
  if (params.has('width')) {
    const width = Number(params.get('width'));
    if (Number.isInteger(width) && width >= 1 && width <= 2000) widthInput.value = width;
  }
  if (params.has('mode') && DISPLAY_MODES[params.get('mode')]) {
    modeSelect.value = params.get('mode');
  }
  if (params.has('channel') && ['red', 'green', 'blue'].includes(params.get('channel'))) {
    channelSelect.value = params.get('channel');
  }
}

function nudgeStart(delta) {
  let start;
  try {
    start = parseNonNegativeBigInt(startInput.value);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }

  start += BigInt(delta);
  if (start < 0n) start = 0n;
  startInput.value = start.toString();
  render();
}

function nudgeWidth(delta) {
  const current = Number(widthInput.value);
  const width = Number.isFinite(current) ? Math.round(current) : 100;
  widthInput.value = Math.max(1, Math.min(2000, width + delta));
  render();
}

function moveByDigits(delta) {
  let start;
  try {
    start = parseNonNegativeBigInt(startInput.value);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }

  start += BigInt(delta);
  if (start < 0n) start = 0n;
  startInput.value = start.toString();
  render();
}

function moveRows(direction, rowCount) {
  const count = Math.max(1, Math.floor(rowCount));
  const dpp = BigInt(getMode().digitsPerPixel);
  moveByDigits(BigInt(direction) * BigInt(rowWidth) * BigInt(count) * dpp);
}

function moveHalfPage(direction) {
  moveRows(direction, Math.max(1, Math.floor(rows / 2)));
}

function movePage(direction) {
  moveRows(direction, rows);
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
  if (col < 0 || col >= rowWidth || row < 0 || row >= rows || local >= renderedPixels) return null;
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

      if (col < 0 || col >= rowWidth || row < 0 || row >= rows || i < 0 || i >= renderedPixels) {
        mctx.fillStyle = '#111722';
        mctx.fillRect(px, py, box, box);
        continue;
      }

      const descriptor = getPixelDescriptor(i);
      if (!descriptor) {
        mctx.fillStyle = '#111722';
        mctx.fillRect(px, py, box, box);
        continue;
      }

      mctx.fillStyle = descriptor.color;
      mctx.fillRect(px, py, box, box);

      mctx.strokeStyle = dx === 0 && dy === 0 ? '#ffffff' : 'rgba(255,255,255,.16)';
      mctx.lineWidth = dx === 0 && dy === 0 ? 2 : 1;
      mctx.strokeRect(px + .5, py + .5, box - 1, box - 1);

      const textSize = descriptor.cellText.length <= 2 ? 14 :
        descriptor.cellText.length <= 3 ? 10 : 7;
      mctx.font = `bold ${textSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      mctx.textAlign = 'center';
      mctx.textBaseline = 'middle';
      mctx.fillStyle = '#ffffff';
      mctx.shadowColor = 'rgba(0,0,0,.9)';
      mctx.shadowBlur = 4;
      mctx.fillText(descriptor.cellText, px + box / 2, py + box / 2);
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

  const descriptor = getPixelDescriptor(cell.local);
  if (!descriptor) {
    magnifier.hidden = true;
    return;
  }

  magnifierIndex.textContent = descriptor.sourceStart === descriptor.sourceEnd
    ? `index ${descriptor.sourceStart.toString()}`
    : `indices ${descriptor.sourceStart.toString()}–${descriptor.sourceEnd.toString()}`;
  magnifierDigit.textContent = descriptor.detail;
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
startDecrement.addEventListener('click', () => nudgeStart(-1));
startIncrement.addEventListener('click', () => nudgeStart(1));
startInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    nudgeStart(-1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    nudgeStart(1);
  }
});

widthDecrement.addEventListener('click', () => nudgeWidth(-1));
widthIncrement.addEventListener('click', () => nudgeWidth(1));
widthInput.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    nudgeWidth(-1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    nudgeWidth(1);
  }
});

modeSelect.addEventListener('change', () => {
  updateModeControls();
  render();
});

channelSelect.addEventListener('change', render);

homeButton.addEventListener('click', () => {
  startInput.value = '0';
  render();
});

prevButton.addEventListener('click', () => movePage(-1));
prevHalfButton.addEventListener('click', () => moveHalfPage(-1));
prevTenRowsButton.addEventListener('click', () => moveRows(-1, 10));
prevRowButton.addEventListener('click', () => moveRows(-1, 1));
nextRowButton.addEventListener('click', () => moveRows(1, 1));
nextTenRowsButton.addEventListener('click', () => moveRows(1, 10));
nextHalfButton.addEventListener('click', () => moveHalfPage(1));
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
updateModeControls();
render();
