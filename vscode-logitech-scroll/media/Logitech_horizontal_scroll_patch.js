/*
 * Logitech horizontal scroll patch
 * Options+ 的 VS Code 配置：侧轮左 = Ctrl+Shift+[，侧轮右 = Ctrl+Shift+]。
 * 鼠标悬停标签栏时滚动标签列表；否则在代码编辑器内滚动代码。
 * 由 Custom CSS and JS Loader 加载；无需添加 VS Code 键绑定。
 */
(() => {
  'use strict';

  // 修改后执行 “Logitech: 启用或更新横滚补丁”；也可用下面的 setConfig 临时调参。
  const CONFIG = {
    STEP_PX: 320,            // 每次快捷键产生的横滚输入量；越大越快。
    TAB_STEP_PX: 120,        // 标签栏每次快捷键的横滚输入量，可单独调速。
    TAB_SPEED_MULTIPLIER: 4, // 标签栏速度倍率；有效步长 = TAB_STEP_PX × 此值。
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
  let pointer = null;
  const handledKeys = new Set();
  const removers = [];
  const stats = { keyPulses: 0, tabPulses: 0, wheelEvents: 0, fallbackPulses: 0 };

  function validate(value) {
    const result = { ...value, LEFT: { ...value.LEFT }, RIGHT: { ...value.RIGHT } };
    for (const [name, minimum, maximum] of [
      ['STEP_PX', 1, 4000], ['TAB_STEP_PX', 1, 4000],
      ['TAB_SPEED_MULTIPLIER', 0.1, 100],
      ['DURATION_MS', 0, 2000], ['MAX_PENDING_STEPS', 1, 1024],
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

  function tabsFor(element) {
    const strip = element?.closest?.('.tabs-and-actions-container');
    if (!strip || !strip.closest('.part.editor')) return null;
    const tabs = strip.querySelector('.tabs-container');
    const target = tabs?.closest('.monaco-scrollable-element');
    if (!target || !strip.contains(target) || !target.contains(element)) return null;
    // 从容器发送，绕过 tabs-container 上“滚轮切换活动标签”的监听器。
    return { kind: 'tabs', owner: strip, target };
  }

  function pointerElement() {
    return pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
  }

  function surfaceFor(event) {
    const hoveredTabs = tabsFor(pointerElement());
    if (hoveredTabs) return hoveredTabs;
    if (!pointer) {
      const focusedTabs = tabsFor(event.target);
      if (focusedTabs) return focusedTabs;
    }
    const editor = editorFor(event.target);
    if (!editor || editorFor(document.activeElement) !== editor) return null;
    const target = editor.querySelector('.monaco-scrollable-element.editor-scrollable') ||
      editor.querySelector('.monaco-scrollable-element');
    return target ? { kind: 'editor', owner: editor, target } : null;
  }

  function surfaceIsCurrent(surface) {
    if (surface.kind === 'editor') return editorFor(document.activeElement) === surface.owner;
    const tabs = tabsFor(pointer ? pointerElement() : document.activeElement);
    return tabs?.owner === surface.owner && tabs.target === surface.target;
  }

  function trackPointer(event) {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      pointer = { x: event.clientX, y: event.clientY };
      if (motion && !surfaceIsCurrent(motion)) stop();
    }
  }

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    motion = null;
  }

  function emit(surface, pixels) {
    const target = surface.target;
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
    // 标签全部可见或已到两端时也消费快捷键，避免落入代码滚动键绑定。
    return event.defaultPrevented || surface.kind === 'tabs';
  }

  function schedule() {
    if (frame === null && motion) frame = window.requestAnimationFrame(animate);
  }

  function animate(now) {
    frame = null;
    const current = motion;
    if (!current) return;
    if (document.hidden || !current.target.isConnected || !surfaceIsCurrent(current)) {
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
    if (pixels && !emit(current, pixels)) {
      stop();
      return;
    }
    if (progress === 1) stop();
    else schedule();
  }

  function enqueue(surface, direction) {
    if (config.INVERT) direction = -direction;
    const stepSize = surface.kind === 'tabs' ? config.TAB_STEP_PX * config.TAB_SPEED_MULTIPLIER : config.STEP_PX;
    const step = direction * stepSize;
    if (motion && (motion.owner !== surface.owner || motion.target !== surface.target || Math.sign(motion.remaining) !== direction)) {
      stop();
    }
    if (config.DURATION_MS === 0) return emit(surface, step);

    if (!motion) {
      // 先试 1 像素。Monaco 未接收时不拦截快捷键，保留已有键绑定作为后备。
      if (!emit(surface, direction)) return false;
      motion = { ...surface, remaining: -direction, fraction: 0 };
    }
    const limit = stepSize * config.MAX_PENDING_STEPS;
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
    const surface = surfaceFor(event);
    if (!surface) return;
    if (!enqueue(surface, direction)) {
      stats.fallbackPulses++;
      return;
    }
    stats.keyPulses++;
    if (surface.kind === 'tabs') stats.tabPulses++;
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
    pointer = null;
  }

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }

  listen(window, 'keydown', onKeyDown, true);
  listen(window, 'keyup', onKeyUp, true);
  listen(window, 'pointermove', trackPointer, { capture: true, passive: true });
  listen(window, 'pointerover', trackPointer, { capture: true, passive: true });
  listen(window, 'pointerout', event => {
    if (!event.relatedTarget) { pointer = null; stop(); }
  }, { capture: true, passive: true });
  listen(window, 'blur', loseFocus, true);
  listen(window, 'pointerdown', event => { trackPointer(event); stop(); }, true);
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
