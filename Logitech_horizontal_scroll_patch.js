/*
 * Logitech horizontal scroll patch
 * Options+ 的 VS Code 配置：侧轮左 = Ctrl+Shift+[，侧轮右 = Ctrl+Shift+]。
 * 由 Custom CSS and JS Loader 加载；无需添加 VS Code 键绑定。
 */
(() => {
  'use strict';

  // 修改后执行 “Reload Custom CSS and JS”；也可用下面的 setConfig 临时调参。
  const CONFIG = {
    STEP_PX: 320,            // 每次快捷键产生的横滚输入量；越大越快。
    DURATION_MS: 500,       // 每次输入的平滑动画时长；0 = 直接滚动。
    MAX_PENDING_STEPS: 1024,   // 快速连转时最多积压几步，限制松手后的拖尾。
    INVERT: true,         // 反转左右方向。
    LEFT:  { code: 'BracketLeft',  ctrl: true, shift: true, alt: false, meta: false },
    RIGHT: { code: 'BracketRight', ctrl: true, shift: true, alt: false, meta: false },
  };

  const NAME = 'logitechHorizontalScrollPatch';
  let config = validate(CONFIG);
  window[NAME]?.dispose?.();

  let motion = null;
  let frame = null;
  let disposed = false;
  const handledKeys = new Set();
  const removers = [];
  const stats = { keyPulses: 0, wheelEvents: 0, fallbackPulses: 0 };

  function validate(value) {
    const result = { ...value, LEFT: { ...value.LEFT }, RIGHT: { ...value.RIGHT } };
    for (const [name, minimum, maximum] of [
      ['STEP_PX', 1, 4000], ['DURATION_MS', 0, 2000], ['MAX_PENDING_STEPS', 1, 1024],
    ]) {
      if (!Number.isFinite(result[name]) || result[name] < minimum || result[name] > maximum) {
        throw new RangeError(`${NAME}: ${name} must be between ${minimum} and ${maximum}`);
      }
    }
    if (typeof result.INVERT !== 'boolean') throw new TypeError(`${NAME}: INVERT must be boolean`);
    for (const shortcut of [result.LEFT, result.RIGHT]) {
      if (typeof shortcut.code !== 'string' || !shortcut.code) throw new TypeError(`${NAME}: missing key code`);
      for (const modifier of ['ctrl', 'shift', 'alt', 'meta']) {
        if (typeof shortcut[modifier] !== 'boolean') throw new TypeError(`${NAME}: invalid modifier ${modifier}`);
      }
    }
    if (['code', 'ctrl', 'shift', 'alt', 'meta'].every(key => result.LEFT[key] === result.RIGHT[key])) {
      throw new TypeError(`${NAME}: LEFT and RIGHT must be different shortcuts`);
    }
    return result;
  }

  function keyCode(event) {
    // Windows 通常提供 event.code；保留缺失 code 时的方括号兼容。
    if (event.code) return event.code;
    if (event.key === '[' || event.key === '{') return 'BracketLeft';
    if (event.key === ']' || event.key === '}') return 'BracketRight';
    return event.key;
  }

  function matches(event, shortcut) {
    return keyCode(event) === shortcut.code &&
      !!event.ctrlKey === shortcut.ctrl && !!event.shiftKey === shortcut.shift &&
      !!event.altKey === shortcut.alt && !!event.metaKey === shortcut.meta;
  }

  function editorFor(element) {
    if (!element?.closest) return null;
    // 快速输入、查找、重命名和普通输入框保留原有键盘行为。
    if (element.closest('input, select, .find-widget, .rename-box, .quick-input-widget')) return null;
    if (element.tagName === 'TEXTAREA' && !element.classList.contains('inputarea')) return null;
    return element.closest('.monaco-editor');
  }

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    motion = null;
  }

  function emit(target, pixels) {
    if (!pixels || !target.isConnected) return false;
    const rect = target.getBoundingClientRect();
    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, composed: true,
      deltaMode: 0, deltaX: pixels, deltaY: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      view: window,
      // 原快捷键的 Ctrl/Shift 不传给滚轮，避免缩放或再次转换坐标轴。
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    target.dispatchEvent(event);
    stats.wheelEvents++;
    // Monaco 自己处理该事件并同步自己的滚动模型；不直接改 DOM.scrollLeft。
    return event.defaultPrevented;
  }

  function schedule() {
    if (frame === null && motion) frame = window.requestAnimationFrame(animate);
  }

  function animate(now) {
    frame = null;
    const current = motion;
    if (!current) return;
    if (document.hidden || !current.target.isConnected || editorFor(document.activeElement) !== current.editor) {
      stop();
      return;
    }
    const progress = Math.min(1, Math.max(0, (now - current.started) / config.DURATION_MS));
    const remaining = current.initialRemaining * (1 - progress) ** 3;
    current.fraction += current.remaining - remaining;
    current.remaining = remaining;
    // 累积亚像素量，避免每帧取整丢掉输入，最后一帧一次结清。
    const pixels = progress === 1 ? Math.round(current.fraction) : Math.trunc(current.fraction);
    current.fraction -= pixels;
    if (pixels && !emit(current.target, pixels)) {
      stop();
      return;
    }
    if (progress === 1) stop();
    else schedule();
  }

  function enqueue(editor, target, direction) {
    if (config.INVERT) direction = -direction;
    const step = direction * config.STEP_PX;
    if (motion && (motion.editor !== editor || motion.target !== target || Math.sign(motion.remaining) !== direction)) {
      stop();
    }
    if (config.DURATION_MS === 0) return emit(target, step);

    if (!motion) {
      // 先试 1 像素。Monaco 未接收时不拦截快捷键，保留已有键绑定作为后备。
      if (!emit(target, direction)) return false;
      motion = { editor, target, remaining: -direction, fraction: 0 };
    }
    const limit = config.STEP_PX * config.MAX_PENDING_STEPS;
    motion.remaining = Math.max(-limit, Math.min(limit, motion.remaining + step));
    motion.initialRemaining = motion.remaining;
    motion.started = window.performance.now();
    if (motion.remaining === 0) stop();
    else schedule();
    return true;
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || disposed) return;
    const direction = matches(event, config.LEFT) ? -1 : matches(event, config.RIGHT) ? 1 : 0;
    if (!direction) return;
    const editor = editorFor(event.target);
    if (!editor || editorFor(document.activeElement) !== editor) return;
    const target = editor.querySelector('.monaco-scrollable-element.editor-scrollable') ||
      editor.querySelector('.monaco-scrollable-element');
    if (!target) return;
    if (!enqueue(editor, target, direction)) {
      stats.fallbackPulses++;
      return;
    }
    stats.keyPulses++;
    handledKeys.add(keyCode(event));
    event.preventDefault();
    event.stopImmediatePropagation(); // 阻止现有 scrollLeft/editorScroll 再执行一遍。
  }

  function onKeyUp(event) {
    if (!handledKeys.delete(keyCode(event))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function loseFocus() {
    stop();
    handledKeys.clear();
  }

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }

  listen(window, 'keydown', onKeyDown, true);
  listen(window, 'keyup', onKeyUp, true);
  listen(window, 'blur', loseFocus, true);
  listen(window, 'pointerdown', stop, true);
  listen(window, 'wheel', event => { if (event.isTrusted) stop(); }, { capture: true, passive: true });
  listen(document, 'visibilitychange', () => { if (document.hidden) loseFocus(); }, true);

  const api = {
    getConfig: () => ({ ...config, LEFT: { ...config.LEFT }, RIGHT: { ...config.RIGHT } }),
    getStats: () => ({ ...stats, animating: motion !== null }),
    setConfig(patch) {
      if (disposed) throw new Error(`${NAME}: patch is disposed`);
      for (const name of Object.keys(patch)) {
        if (!Object.prototype.hasOwnProperty.call(CONFIG, name)) throw new TypeError(`${NAME}: unknown setting ${name}`);
      }
      const next = validate({ ...config, ...patch,
        LEFT: { ...config.LEFT, ...patch.LEFT }, RIGHT: { ...config.RIGHT, ...patch.RIGHT },
      });
      stop();
      config = next;
      return api.getConfig();
    },
    dispose() {
      loseFocus();
      removers.splice(0).forEach(remove => remove());
      disposed = true;
      if (window[NAME] === api) delete window[NAME];
    },
  };
  window[NAME] = api;
})();
