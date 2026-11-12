'use strict';

// One clock supplies both the CSS caret (including Vim) and the canvas trail.
(() => {
  window.vscodeCursorColorFlow?.dispose();
  const options = window.vscodeCursorTrailOptions || {};
  const caretStyles = options.CURSOR_STYLES_ENABLED !== false;
  const seconds = Number.isFinite(options.COLOR_CYCLE_SECONDS) ? Math.max(2, Math.min(60, options.COLOR_CYCLE_SECONDS)) : 12;
  const fps = Math.min(30, Number.isFinite(options.MAX_FPS) ? Math.max(15, options.MAX_FPS) : 30);
  const frameMs = 1000 / fps;
  const names = ['rose', 'pink', 'fuchsia', 'blush', 'orchid', 'violet', 'ice'];
  let palette = [[255,104,186],[255,104,212],[255,104,237],[230,104,255],[215,104,255],[163,104,255],[104,226,255]]
    .map(([r,g,b]) => ({ r, g, b }));
  const gradientProperty = '--customize-imports-cursor-gradient';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const removers = [];
  let root = null, originalGradient = '', originalPriority = '';
  let paletteKey, paletteContext, revision = 0, frame = null, lastPublished = '';
  let accumulatedMs = 0, activeSince = null;
  let isFocused = document.hasFocus(), caretPresent = false, disposed = false;
  let rafId = null, scanTimer = null, rootObserver = null;

  const wrap = value => ((value % 1) + 1) % 1;
  const rgb = color => `rgb(${color.r.toFixed(1)},${color.g.toFixed(1)},${color.b.toFixed(1)})`;
  function toHsl(color) {
    const r = color.r / 255, g = color.g / 255, b = color.b / 255;
    const maximum = Math.max(r,g,b), minimum = Math.min(r,g,b);
    const delta = maximum - minimum, l = (maximum + minimum) / 2;
    if (!delta) return { h: 0, s: 0, l };
    let h;
    if (maximum === r) h = (g-b) / delta;
    else if (maximum === g) h = (b-r) / delta + 2;
    else h = (r-g) / delta + 4;
    return { h: wrap(h / 6), s: delta / (1 - Math.abs(2*l - 1)), l };
  }
  function rotateHue(color, phase) {
    const h = wrap(color.h + phase) * 6;
    const c = (1 - Math.abs(2*color.l - 1)) * color.s;
    const x = c * (1 - Math.abs(h % 2 - 1)), m = color.l - c / 2;
    const sector = Math.min(5, Math.floor(h));
    return { r: ([c,x,0,0,x,c][sector]+m)*255,
      g: ([x,c,c,x,0,0][sector]+m)*255, b: ([0,0,x,c,c,x][sector]+m)*255 };
  }
  function buildSpatialPalette(colors) {
    // Like 77caafe, interpolate hue along the shortest arc before converting to RGB.
    // Space anchors by color distance so nearby pinks do not form wide stripes.
    const anchors = colors.map(color => ({ ...color, position: 0 }));
    let distance = 0;
    for (let i = 1; i < anchors.length; i++) {
      const previous = anchors[i - 1], current = anchors[i];
      const hueDelta = wrap(current.h - previous.h + 0.5) - 0.5;
      current.h = previous.h + hueDelta;
      distance += Math.max(0.000001, Math.hypot(hueDelta, (current.s - previous.s) * 0.25, (current.l - previous.l) * 0.5));
      current.position = distance;
    }
    anchors.forEach(color => { color.position /= distance; });
    // Cache dense HSL samples once per palette change; both renderers use them.
    const positions = new Set(anchors.map(color => color.position));
    for (let i = 0; i <= 32; i++) positions.add(i / 32);
    let index = 0;
    return [...positions].sort((a, b) => a - b).map(position => {
      while (index < anchors.length - 2 && position > anchors[index + 1].position) index++;
      const left = anchors[index], right = anchors[index + 1];
      const t = (position - left.position) / (right.position - left.position);
      return { position, color: { h: left.h + (right.h - left.h) * t,
        s: left.s + (right.s - left.s) * t, l: left.l + (right.l - left.l) * t } };
    });
  }
  let paletteHsl = palette.map(toHsl), spatialPalette = buildSpatialPalette(paletteHsl);
  function restoreGradient() {
    if (!root || !caretStyles) return;
    if (originalGradient) root.style.setProperty(gradientProperty, originalGradient, originalPriority);
    else root.style.removeProperty(gradientProperty);
  }
  function syncRoot() {
    const current = document.querySelector('.monaco-workbench');
    if (current === root) return;
    rootObserver?.disconnect();
    restoreGradient();
    root = current; paletteKey = undefined; lastPublished = '';
    originalGradient = root?.style.getPropertyValue(gradientProperty) || '';
    originalPriority = root?.style.getPropertyPriority(gradientProperty) || '';
    if (root) {
      rootObserver = new MutationObserver(refresh);
      rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
    }
  }
  function syncPalette() {
    if (!root) return;
    const css = getComputedStyle(root);
    const values = names.map(name => css.getPropertyValue(`--customize-imports-cursor-${name}`).trim());
    const key = values.join('|');
    if (key === paletteKey) return;
    paletteKey = key;
    if (!paletteContext) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      paletteContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    palette = values.map((value, index) => {
      if (!value || !paletteContext || !CSS.supports('color', value)) return palette[index];
      paletteContext.clearRect(0, 0, 1, 1);
      paletteContext.fillStyle = value; paletteContext.fillRect(0, 0, 1, 1);
      const [r,g,b] = paletteContext.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    });
    paletteHsl = palette.map(toHsl);
    spatialPalette = buildSpatialPalette(paletteHsl);
    revision++;
  }
  function setRunning(running) {
    const now = performance.now();
    if (running && activeSince === null) activeSince = now;
    else if (!running && activeSince !== null) { accumulatedMs += now - activeSince; activeSince = null; }
  }
  function getFrame() {
    if (disposed && frame) return frame;
    const elapsed = accumulatedMs + (activeSince === null ? 0 : Math.max(0, performance.now() - activeSince));
    const bucket = Math.floor(elapsed / frameMs), key = `${revision}:${bucket}`;
    if (frame?.key !== key) {
      const phase = wrap(bucket * frameMs / (seconds * 1000));
      // 77caafe: h(t) = (baseHue + elapsedSeconds * 30) % 360.
      // Keep the spatial stops fixed and roll the whole gradient's HSL hue.
      const stops = spatialPalette.map(stop => ({ position: stop.position, color: rotateHue(stop.color, phase) }));
      const gradient = `linear-gradient(180deg,${stops.map(stop => `${rgb(stop.color)} ${(stop.position*100).toFixed(5)}%`).join(',')})`;
      frame = { key, phase, hueOffset: phase * 360, palette, stops,
        head: stops[0].color, tail: stops[stops.length - 1].color, glow: rotateHue(paletteHsl[2], phase), gradient };
    }
    if (!disposed && caretStyles && root && lastPublished !== frame.gradient) {
      root.style.setProperty(gradientProperty, frame.gradient);
      lastPublished = frame.gradient;
    }
    return frame;
  }
  function stopAnimation() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function animate() {
    rafId = null;
    if (disposed || !caretStyles || !caretPresent || activeSince === null || document.hidden) return;
    getFrame();
    rafId = requestAnimationFrame(animate);
  }
  function refresh() {
    if (disposed) return;
    syncRoot();
    const reduced = reducedMotion.matches || Boolean(root?.classList.contains('monaco-reduce-motion'));
    setRunning(isFocused && !document.hidden && !reduced);
    if (!document.hidden && isFocused) syncPalette();
    caretPresent = false;
    if (caretStyles && root && activeSince !== null) {
      for (const caret of root.querySelectorAll('.monaco-editor .cursor')) {
        const rect = caret.getBoundingClientRect();
        // Blink/expand transforms must not pause the shared color clock.
        if (caret.offsetWidth > 0 && caret.offsetHeight > 0 && rect.bottom >= 0 && rect.right >= 0
            && rect.top < innerHeight && rect.left < innerWidth) {
          caretPresent = true; break;
        }
      }
    }
    getFrame();
    if (caretPresent && activeSince !== null) {
      if (rafId === null) rafId = requestAnimationFrame(animate);
    } else stopAnimation();
  }
  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }
  function bootstrap() {
    if (disposed) return;
    isFocused = document.hasFocus();
    listen(window, 'focus', () => { isFocused = document.hasFocus(); refresh(); });
    listen(window, 'blur', () => { isFocused = false; refresh(); });
    listen(document, 'visibilitychange', () => { isFocused = document.hasFocus(); refresh(); });
    listen(document, 'focusin', refresh);
    listen(document, 'pointerup', refresh, true);
    listen(reducedMotion, 'change', refresh);
    refresh();
    scanTimer = setInterval(refresh, 250);
  }
  const api = {
    getFrame,
    getStats: () => ({ phase: frame?.phase || 0, hueOffset: frame?.hueOffset || 0, gradient: frame?.gradient || '', running: activeSince !== null,
      animating: rafId !== null, cycleSeconds: seconds, disposed }),
    dispose() {
      disposed = true;
      stopAnimation(); clearInterval(scanTimer); rootObserver?.disconnect();
      removers.splice(0).forEach(remove => remove());
      restoreGradient(); root = null;
      if (window.vscodeCursorColorFlow === api) delete window.vscodeCursorColorFlow;
    },
  };
  window.vscodeCursorColorFlow = api;
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
