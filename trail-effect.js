'use strict';
/* ============================================================================
 * VSCode Cursor Trail Effect
 *   - Catmull-Rom→Bezier 平滑光带；头粗尾细的锥形 + 头/尾 alpha 渐入/渐隐
 *   - 离屏 canvas + 双层 ctx.filter blur 合成 bloom 泛光（'lighter' 模式）
 *   - 视口级 fixed canvas，多光标共享同一份 bloom 合成
 *   - HSL 直存 + 帧节流，hue 时间驱动与帧率解耦
 *
 * 颜色一致性约束：
 *   - START_COLOR_HSL / END_COLOR_HSL  ↔  vscode-custom.css 中 div.cursor 的 linear-gradient
 *   - CURSOR_VISUAL_X/Y_SCALE          ↔  vscode-custom.css 中 div.cursor::after 的 transform: scale
 * ========================================================================== */

(() => {
  /* --------------------------- CONFIG --------------------------- */
  const CONFIG = {
    TRAIL_LENGTH: 24,
    STYLE: 'block',                    // 'block' | 'line'
    CURSOR_POLLING_MS: 150,            // DOM 中 .cursor 节点出现/消失的轮询周期
    // 颜色（HSL 形式，避免 per-frame 的 RGB↔HSL 来回转换）
    // 与 vscode-custom.css 中 div.cursor 渐变同源：
    //   rgb(103,250,243) ≈ hsl(177,93%,69%)
    //   rgb(182,110,255) ≈ hsl(266,100%,72%)
    START_COLOR_HSL: { h: 177, s: 93, l: 69 },
    END_COLOR_HSL:   { h: 266, s: 100, l: 72 },
    HUE_SPEED_DEG_PER_SEC: 30,         // 时间驱动，与帧率无关
    HUE_UPDATE_EVERY: 2,               // 每 N 帧才刷新一次颜色字符串数组
    // 几何（光带宽度沿"运动方向的法线"展开，垂直运动时使用 sizeX，水平运动时使用 sizeY）
    // 光标 DOM 的 clientWidth/Height 不包含 vscode-custom.css 中 div.cursor::after 的 scale(140%, 120%)
    // 视觉发光区域，所以这里把"可见光标尺寸"按对应缩放放大，让拖尾与发光块对齐：
    CURSOR_VISUAL_X_SCALE: 1.4,        // 与 vscode-custom.css 的 ::after transform: scaleX 一致
    CURSOR_VISUAL_Y_SCALE: 1.2,        // 与 vscode-custom.css 的 ::after transform: scaleY 一致
    HEAD_WIDTH_RATIO: 1.0,             // 头部宽度 = 可见光标轮廓宽度 × 1.0（在轴向缩放基础上再做整体微调）
    TAIL_WIDTH_RATIO: 0.15,            // 尾部几何宽度（保留一点不要锐化为针尖；真正"消失"由 alpha 渐隐承担）
    TAIL_TAPER_POWER: 1.0,             // 1.0 = 线性收窄；调大>1 加快尾部收尖
    HEAD_FADE_PARTICLES: 3,            // 前 N 个粒子 alpha 渐入，柔化与光标的衔接
    TAIL_FADE_START: 0.55,             // 沿轨迹比例：超过该位置开始 alpha 衰减；末端 alpha=0
    TAIL_FADE_POWER: 2.5,              // alpha = 1 - tailT^p；p>1 → body 长时间饱满，只在末端急降（"斜率小"的视觉感）
    IDLE_FADE_FRAMES: 90,              // 静止超过 N 帧后整条光带（含 bloom）淡出（~1.5s @ 60fps）
    // Bloom（仅作"边缘柔光"，主光带使用 source-over 避免多层叠加饱和成白色）
    BLOOM_INNER_BLUR_PX: 6,
    BLOOM_OUTER_BLUR_PX: 18,
    BLOOM_INNER_ALPHA: 0.45,
    BLOOM_OUTER_ALPHA: 0.30,
    CORE_ALPHA: 1.0,                   // 主光带（渐变 fill）的不透明度；逐光标 idle alpha 在 ctx.globalAlpha 中应用
    BLOOM_DOWNSCALE: 0.5,              // 离屏 canvas 用 0.5× 分辨率，bloom 不损失观感
    // 物理（保留原拖尾跟随手感）
    LERP_X: 0.42,
    LERP_Y: 0.35,
  };

  const N = CONFIG.TRAIL_LENGTH;

  /* --------------------------- utils --------------------------- */

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** HSL 插值（角度走最短路径） */
  function lerpHsl(c1, c2, t) {
    const dh = ((c2.h - c1.h + 540) % 360) - 180;
    return {
      h: (c1.h + dh * t + 360) % 360,
      s: lerp(c1.s, c2.s, t),
      l: lerp(c1.l, c2.l, t),
    };
  }

  const hsla = (h, s, l, a) =>
    `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a.toFixed(3)})`;

  /* --------------------------- 共享：色相与几何缓存 ---------------------------
   * 这些数组的内容只取决于粒子在轨迹中的相对位置 i/N，与具体光标无关，
   * 因此在所有 TrailModel 之间共享，避免重复计算。
   */

  // 每个粒子的基础 HSL 锚点（沿轨迹的颜色渐变）
  const baseHsl = new Array(N);
  for (let i = 0; i < N; i++) {
    baseHsl[i] = lerpHsl(CONFIG.START_COLOR_HSL, CONFIG.END_COLOR_HSL, i / (N - 1));
  }

  // 每个粒子的目标宽度比例（沿轨迹收敛，TAIL_TAPER_POWER 控制收尖速度）
  const widthRatio = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const eased = Math.pow(t, CONFIG.TAIL_TAPER_POWER);
    widthRatio[i] = lerp(CONFIG.HEAD_WIDTH_RATIO, CONFIG.TAIL_WIDTH_RATIO, eased);
  }

  // 共享色串缓存：仅含头部 alpha 渐入 + 尾部 alpha 渐隐 + 当前 hueOffset；
  // 每光标的 idle 淡出在渲染时通过 ctx.globalAlpha 单独叠加。
  const colorStrCache = new Array(N).fill('hsla(0,0%,100%,1)');
  let hueOffset = 0;
  let lastTimeMs = 0;
  let frameCounter = 0;

  function refreshSharedColors() {
    const fadeN = CONFIG.HEAD_FADE_PARTICLES;
    const tailFadeStartIdx = CONFIG.TAIL_FADE_START * (N - 1);
    for (let i = 0; i < N; i++) {
      const c = baseHsl[i];
      const h = (c.h + hueOffset) % 360;
      let a = 1;
      if (i < fadeN) a *= (i + 1) / (fadeN + 1);
      if (i > tailFadeStartIdx) {
        const tailT = (i - tailFadeStartIdx) / (N - 1 - tailFadeStartIdx);
        a *= clamp(1 - Math.pow(tailT, CONFIG.TAIL_FADE_POWER), 0, 1);
      }
      colorStrCache[i] = hsla(h, c.s, c.l, a);
    }
  }

  /* --------------------------- TrailModel（per-cursor 状态） --------------------------- */

  function createTrailModel() {
    const particles = new Array(N);
    for (let i = 0; i < N; i++) particles[i] = { x: 0, y: 0 };
    const tangents = new Array(N);
    for (let i = 0; i < N; i++) tangents[i] = { x: 1, y: 0 };

    const cursor = { x: 0, y: 0 };
    const lastCursor = { x: 0, y: 0 };
    let sizeX = 7;
    let sizeY = 16;
    let initted = false;
    let idleFrames = 0;
    let globalAlpha = 0;

    function updateCursorSize(w, h) {
      sizeX = w;
      if (h) sizeY = h;
    }

    /** 把全部粒子吸附到 (x, y) 并重置 idle —— move() 与 setImmediate() 共用的种子操作。 */
    function seedAt(x, y) {
      initted = true;
      for (let i = 0; i < N; i++) {
        particles[i].x = x;
        particles[i].y = y;
      }
      lastCursor.x = x;
      lastCursor.y = y;
      idleFrames = 0;
    }

    function move(rawX, rawY) {
      // 粒子位置以光标"几何中心"为参考点（CSS ::after scale 默认从中心展开）
      const x = rawX + sizeX / 2;
      const y = rawY + sizeY / 2;
      // 仅在"几乎不可见"时重新种子（首次 or 已淡出）—— 此时 reset 无视觉断裂。
      // 不做距离阈值检测：让物理链自然把粒子从旧位置拖到新位置，
      // Home/End / Ctrl+Home / 远点击都形成一条"扫过去"的拖尾。
      const reseed = !initted || globalAlpha < 0.05;
      cursor.x = x;
      cursor.y = y;
      if (reseed) seedAt(x, y);
    }

    /** 强制吸附到当前位置（无视任何阈值/动画状态）。
     *  用于：滚动时让光带不去"追赶"被滚动条带走的虚假位移。 */
    function setImmediate(rawX, rawY) {
      const x = rawX + sizeX / 2;
      const y = rawY + sizeY / 2;
      cursor.x = x;
      cursor.y = y;
      seedAt(x, y);
    }

    /** 推进物理 + 切线 + idle alpha；不做任何绘制。 */
    function tickPhysics() {
      if (!initted) {
        globalAlpha = 0;
        return;
      }
      // 链式 lerp：每个粒子向"后一个粒子"靠拢，形成跟随感
      let x = cursor.x;
      let y = cursor.y;
      for (let i = 0; i < N; i++) {
        const next = particles[(i + 1) % N];
        const cur = particles[i];
        cur.x = x;
        cur.y = y;
        const dx = (next.x - cur.x) * CONFIG.LERP_X;
        const dy = (next.y - cur.y) * CONFIG.LERP_Y;
        x += dx;
        y += dy;
      }
      // 中心差分切线：(t.x, t.y) 用于 (a) 法线方向展开光带宽度  (b) 头部偏移到光标尾随边
      for (let i = 0; i < N; i++) {
        const a = particles[i === 0 ? 0 : i - 1];
        const b = particles[i === N - 1 ? N - 1 : i + 1];
        const tx = b.x - a.x;
        const ty = b.y - a.y;
        const len = Math.hypot(tx, ty);
        if (len > 0.01) {
          tangents[i].x = tx / len;
          tangents[i].y = ty / len;
        }
      }
      // 静止检测 → idle 淡出
      const moved = cursor.x !== lastCursor.x || cursor.y !== lastCursor.y;
      if (moved) {
        idleFrames = 0;
        lastCursor.x = cursor.x;
        lastCursor.y = cursor.y;
      } else {
        idleFrames++;
      }
      globalAlpha = clamp(1 - idleFrames / CONFIG.IDLE_FADE_FRAMES, 0, 1);
    }

    return {
      move,
      setImmediate,
      updateCursorSize,
      tickPhysics,
      get particles() { return particles; },
      get tangents() { return tangents; },
      get sizeX() { return sizeX; },
      get sizeY() { return sizeY; },
      get globalAlpha() { return globalAlpha; },
      get visible() { return initted && globalAlpha > 0.001; },
    };
  }

  /* --------------------------- TrailScene（共享 canvas + bloom 合成） --------------------------- */

  function createTrailScene(canvas) {
    const ctx = canvas.getContext('2d');
    const bloomCanvas = document.createElement('canvas');
    const bctx = bloomCanvas.getContext('2d');
    let width = 0;
    let height = 0;

    function updateSize(w, h) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      bloomCanvas.width = Math.max(1, Math.floor(w * CONFIG.BLOOM_DOWNSCALE));
      bloomCanvas.height = Math.max(1, Math.floor(h * CONFIG.BLOOM_DOWNSCALE));
    }

    function clear() {
      ctx.clearRect(0, 0, width, height);
      bctx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
    }

    /* ---- per-model 路径 / 几何 ----
     * 这些函数都从 model 中取 particles/tangents/sizeX/sizeY。所有"形状"逻辑共享，
     * 只是输入不同。
     */

    function tracePath(targetCtx, model, offsetFn, reverse) {
      const particles = model.particles;
      const idx = (k) => (reverse ? N - 1 - k : k);
      const p0 = particles[idx(0)];
      const off = offsetFn(idx(0));
      targetCtx.moveTo(p0.x + off.dx, p0.y + off.dy);
      for (let i = 0; i < N - 1; i++) {
        const p_1 = particles[idx(Math.max(0, i - 1))];
        const p1 = particles[idx(i)];
        const p2 = particles[idx(i + 1)];
        const p3 = particles[idx(Math.min(N - 1, i + 2))];
        const o1 = offsetFn(idx(i));
        const o2 = offsetFn(idx(i + 1));
        const o0 = offsetFn(idx(Math.max(0, i - 1)));
        const o3 = offsetFn(idx(Math.min(N - 1, i + 2)));
        const c1x = p1.x + o1.dx + ((p2.x + o2.dx) - (p_1.x + o0.dx)) / 6;
        const c1y = p1.y + o1.dy + ((p2.y + o2.dy) - (p_1.y + o0.dy)) / 6;
        const c2x = p2.x + o2.dx - ((p3.x + o3.dx) - (p1.x + o1.dx)) / 6;
        const c2y = p2.y + o2.dy - ((p3.y + o3.dy) - (p1.y + o1.dy)) / 6;
        targetCtx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x + o2.dx, p2.y + o2.dy);
      }
    }

    function headBlend(i) {
      return i < CONFIG.HEAD_FADE_PARTICLES
        ? 1 - (i + 1) / (CONFIG.HEAD_FADE_PARTICLES + 1)
        : 0;
    }

    function drawTaperedBand(targetCtx, model) {
      const particles = model.particles;
      const tangents = model.tangents;
      const visX = model.sizeX * CONFIG.CURSOR_VISUAL_X_SCALE;
      const visY = model.sizeY * CONFIG.CURSOR_VISUAL_Y_SCALE;

      const headOffsetMag = (i) => {
        const blend = headBlend(i);
        if (blend === 0) return 0;
        const t = tangents[i];
        const depth = visX * Math.abs(t.x) + visY * Math.abs(t.y);
        return depth * 0.5 * blend;
      };

      const sideOffset = (i, sign) => {
        const t = tangents[i];
        const nx = -t.y;
        const ny = t.x;
        const baseThickness = visX * Math.abs(t.y) + visY * Math.abs(t.x);
        const halfW = baseThickness * widthRatio[i] * 0.5 * sign;
        const ho = headOffsetMag(i);
        return {
          dx: nx * halfW + t.x * ho,
          dy: ny * halfW + t.y * ho,
        };
      };
      const upperOffset = (i) => sideOffset(i, +1);
      const lowerOffset = (i) => sideOffset(i, -1);

      targetCtx.beginPath();
      tracePath(targetCtx, model, upperOffset, false);
      const tail = particles[N - 1];
      const ot = lowerOffset(N - 1);
      targetCtx.lineTo(tail.x + ot.dx, tail.y + ot.dy);
      tracePath(targetCtx, model, lowerOffset, true);
      const head = particles[0];
      const oh = upperOffset(0);
      targetCtx.lineTo(head.x + oh.dx, head.y + oh.dy);
      targetCtx.closePath();
    }

    function makeGradient(targetCtx, model) {
      const particles = model.particles;
      const head = particles[0];
      const tail = particles[N - 1];
      const grad = targetCtx.createLinearGradient(head.x, head.y, tail.x, tail.y);
      const stride = 2;
      for (let i = 0; i < N; i += stride) {
        grad.addColorStop(i / (N - 1), colorStrCache[i]);
      }
      grad.addColorStop(1, colorStrCache[N - 1]);
      return grad;
    }

    function drawCoreBand(targetCtx, model) {
      drawTaperedBand(targetCtx, model);
      targetCtx.fillStyle = makeGradient(targetCtx, model);
      targetCtx.fill();
    }

    function drawLineMode(targetCtx, model) {
      const tangents = model.tangents;
      targetCtx.beginPath();
      const centerOffset = () => ({ dx: 0, dy: 0 });
      tracePath(targetCtx, model, centerOffset, false);
      const t0 = tangents[Math.floor(N / 2)];
      const visX = model.sizeX * CONFIG.CURSOR_VISUAL_X_SCALE;
      const visY = model.sizeY * CONFIG.CURSOR_VISUAL_Y_SCALE;
      const baseThick = visX * Math.abs(t0.y) + visY * Math.abs(t0.x);
      targetCtx.lineWidth = Math.max(2, baseThick * 0.4);
      targetCtx.lineJoin = 'round';
      targetCtx.lineCap = 'round';
      targetCtx.strokeStyle = makeGradient(targetCtx, model);
      targetCtx.stroke();
    }

    function drawTrailShape(targetCtx, model) {
      if (CONFIG.STYLE === 'line') drawLineMode(targetCtx, model);
      else drawCoreBand(targetCtx, model);
    }

    /* ---- 三阶段渲染（多光标共享 bloom 合成） ---- */

    function drawTrailToBloom(model) {
      bctx.save();
      bctx.scale(CONFIG.BLOOM_DOWNSCALE, CONFIG.BLOOM_DOWNSCALE);
      // 该 trail 的 idle 淡出在此处通过 globalAlpha 单独应用
      bctx.globalAlpha = model.globalAlpha;
      drawTrailShape(bctx, model);
      bctx.restore();
    }

    function compositeBloom() {
      // 把已经容纳了所有 trail 的离屏 canvas 两次合成到主画布
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${CONFIG.BLOOM_OUTER_BLUR_PX}px)`;
      ctx.globalAlpha = CONFIG.BLOOM_OUTER_ALPHA;
      ctx.drawImage(bloomCanvas, 0, 0, width, height);
      ctx.filter = `blur(${CONFIG.BLOOM_INNER_BLUR_PX}px)`;
      ctx.globalAlpha = CONFIG.BLOOM_INNER_ALPHA;
      ctx.drawImage(bloomCanvas, 0, 0, width, height);
      ctx.restore();
    }

    function drawTrailToMain(model) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = model.globalAlpha * CONFIG.CORE_ALPHA;
      drawTrailShape(ctx, model);
      ctx.restore();
    }

    return {
      updateSize,
      clear,
      drawTrailToBloom,
      compositeBloom,
      drawTrailToMain,
    };
  }

  /* --------------------------- bootstrap ---------------------------
   * canvas 挂在 document.body 上，position:fixed + 100vw×100vh，使用视口绝对坐标，
   * 这样无论 vscode 内部如何 split / 切换 / 改布局，绘制位置都不会错位。
   * 抓取范围：document.querySelectorAll('.monaco-editor .cursor')，覆盖所有编辑器组与 diff 视图两侧。
   */

  let scene = null;
  /** Map<cursorId: string, { model, target, lastX, lastY }> — 每光标独立状态 */
  const trails = new Map();
  let isScrolling = false;
  let scrollResetTimeout = null;
  let isFocused = document.hasFocus();
  let rafId = null;

  function bootstrap() {
    const canvas = document.createElement('canvas');
    canvas.style.pointerEvents = 'none';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    scene = createTrailScene(canvas);
    updateCanvasSize();

    window.addEventListener('resize', updateCanvasSize);

    // 滚动是"屏幕动而 cursor 没动"，物理跟随会画出一条假性拖尾，必须屏蔽。
    document.addEventListener('scroll', () => {
      isScrolling = true;
      clearTimeout(scrollResetTimeout);
      scrollResetTimeout = setTimeout(() => { isScrolling = false; }, 100);
    }, { capture: true, passive: true });

    window.addEventListener('focus', () => {
      isFocused = true;
      startAnimation();
    });
    window.addEventListener('blur', () => {
      isFocused = false;
      stopAnimation();
      if (scene) scene.clear();
    });

    setInterval(scanCursors, CONFIG.CURSOR_POLLING_MS);
    scanCursors();
    startAnimation();
  }

  function updateCanvasSize() {
    if (scene) scene.updateSize(window.innerWidth, window.innerHeight);
  }

  function scanCursors() {
    const seen = new Set();
    document.querySelectorAll('.monaco-editor .cursor').forEach((target) => {
      let id = target.getAttribute('trail-cursor-id');
      if (!id) {
        id = 'c' + Math.random().toString(36).substring(2, 10);
        target.setAttribute('trail-cursor-id', id);
      }
      seen.add(id);
      if (!trails.has(id)) {
        const model = createTrailModel();
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          model.updateCursorSize(rect.width, rect.height);
        }
        trails.set(id, { model, target, lastX: NaN, lastY: NaN });
      }
    });
    for (const id of trails.keys()) {
      if (!seen.has(id)) trails.delete(id);
    }
  }

  function animate(nowMs) {
    if (!isFocused) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(animate);
    if (!scene) return;

    const dt = lastTimeMs ? (nowMs - lastTimeMs) / 1000 : 0;
    lastTimeMs = nowMs;
    hueOffset = (hueOffset + dt * CONFIG.HUE_SPEED_DEG_PER_SEC) % 360;

    let anyVisible = false;
    for (const data of trails.values()) {
      const { model, target } = data;
      const cs = getComputedStyle(target);
      // 不可见（visibility / display / opacity）→ 跳过位置同步，物理仍推进让其自然淡出
      if (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0') {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 &&
            (rect.left !== data.lastX || rect.top !== data.lastY)) {
          model.updateCursorSize(rect.width, rect.height);
          // 滚动期间硬重置；正常移动走 move()（内部按淡出状态决定是否 reseed）
          if (isScrolling) model.setImmediate(rect.left, rect.top);
          else model.move(rect.left, rect.top);
          data.lastX = rect.left;
          data.lastY = rect.top;
        }
      }
      model.tickPhysics();
      if (model.visible) anyVisible = true;
    }

    if (!anyVisible) {
      scene.clear();
      return;
    }

    if (frameCounter % CONFIG.HUE_UPDATE_EVERY === 0) refreshSharedColors();
    frameCounter++;

    // 三阶段渲染：所有 trail 共用一份 bloom 合成 → 多光标也只一次模糊
    scene.clear();
    for (const data of trails.values()) if (data.model.visible) scene.drawTrailToBloom(data.model);
    scene.compositeBloom();
    for (const data of trails.values()) if (data.model.visible) scene.drawTrailToMain(data.model);
  }

  function startAnimation() {
    if (rafId === null && isFocused) rafId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
