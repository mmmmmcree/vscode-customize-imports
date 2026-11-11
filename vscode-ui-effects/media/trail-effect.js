'use strict';/* ============================================================================
 * VSCode Cursor Trail + Smoke（custom-css 注入）
 *   - 弹簧链跟随：头粗尾细的长条光带（还原 77caafe 形态）
 *   - Catmull-Rom→Bezier 平滑 + 单次描边与低强度 shadowBlur 泛光
 *   - 物理基于固定步长：任意刷新率手感一致，高刷下拖尾不会瞬间收尾
 *   - 烟雾只从链尾尖喷发，浓度随光标速度提升，绝不出现在拖尾中段
 *   - 视口级 fixed canvas
 *
 * 与 vscode-custom.css 的一致性约束：
 *   cursor-palette.css       ↔ 光标与拖尾共用降低亮度后的紫蓝青色板
 *   CURSOR_VISUAL_X/Y_SCALE   ↔ div.cursor::after 的 transform: scale
 * ========================================================================== */

(() => {
  window.vscodeCursorTrail?.dispose();
  /* --------------------------- CONFIG --------------------------- */
  const CONFIG = {
    TRAIL_LENGTH: 24,                  // 链粒子数（拖尾长度旋钮之一：越多越长）
    STYLE: 'block',                    // 'block' | 'line'
    CURSOR_POLLING_MS: 150,            // 轮询 .cursor 节点出现/消失

    // 帧率解耦（固定步长：物理恒以 PHYSICS_FPS 步进，渲染跟显示器 → 任意刷新率手感一致）
    PHYSICS_FPS: 60,                   // 链松弛步进频率。60 = 还原 trail-effect2 在 60fps 下的手感
    MAX_PHYSICS_STEPS: 6,              // 单帧最多补几步（防长卡顿后"追帧"暴走 / spiral of death）
    MAX_FPS: 0,                        // 渲染封顶；0 = 跟随显示器 rAF。>0（如 60）可在高刷屏限帧省电

    // 几何（宽度沿运动法线展开；含 ::after scale 放大以对齐发光块）
    CURSOR_VISUAL_X_SCALE: 1.4,
    CURSOR_VISUAL_Y_SCALE: 1.2,
    BAND_WIDTH_RATIO: 1.0,
    TAIL_FADE_START: 0.55,             // 轨迹比例，超过此处尾部 alpha 渐隐（长条"溶解"收口）
    TAIL_FADE_POWER: 2.5,
    TAIL_FADE_END_ALPHA: 0.0,
    IDLE_FADE_SECONDS: 1.5,            // 静止超过该秒数后整条光带（含泛光）淡出

    // 单次 source-over 描边，光晕与本体一起绘制，避免重复叠亮。
    GLOW_BLUR_PX: 10,
    GLOW_ALPHA: 0.28,
    CORE_ALPHA: 0.90,

    // 物理（弹簧链跟随手感；固定步长 → 与刷新率无关）
    LERP_X: 0.42,
    LERP_Y: 0.35,

    // 烟雾（只从链尾尖喷发）
    SMOKE_ENABLED: true,
    SMOKE_SPAWN_RATE_HZ: 2,           // 打字/低位移时尾尖的背景喷发率
    SMOKE_PIXELS_PER_SPAWN: 8,       // 尾尖每移动 N px 增发 1 颗（慢速时的间隔）
    SMOKE_PIXELS_PER_SPAWN_MIN: 1,    // 满速时的最小间隔（越小越密；随速度从上值收缩到此值，最小 1）
    SMOKE_SPAWN_MIN_DIST: 8,          // 链尾离光标 < 此值时不喷（尾巴太短）
    SMOKE_MAX_PARTICLES: 1000,
    SMOKE_LIFETIME_S: 0.2,
    SMOKE_BASE_RADIUS_PX: 5,
    SMOKE_GROWTH: 2.2,                 // 终点半径 = base × (1 + growth)
    SMOKE_DRIFT_SPEED: 38,            // 随机漂移 px/s
    SMOKE_BACKWARD_BIAS: 28,          // 沿尾部切线继续外漂 px/s
    SMOKE_DRAG_PER_SEC: 0.08,         // 速度每秒衰减到原来的此比例（按 dt 归一）
    SMOKE_PEAK_ALPHA: 0.22,           // 烟雾使用 source-over，重叠时仍保留原有色相
    SMOKE_ALONG_SPREAD: 1.0,         // 沿运动方向的随机散布（×法向宽度）：打散高速时的"烟雾柱"，0=只横向
    // 浓度随光标速度（越快越浓：喷发率 + 不透明度同时提升）
    SMOKE_SPEED_FULL_PXS: 1000,      // 光标速度达此值(px/s)时浓度倍率到最大
    SMOKE_SPEED_RATE_MULT: 6,        // 满速时喷发率倍率上限
    SMOKE_SPEED_ALPHA_MULT: 1.1,     // 满速时不透明度倍率上限
  };

  const options = window.vscodeCursorTrailOptions || {};
  CONFIG.MAX_FPS = Number.isFinite(options.MAX_FPS) ? Math.max(15, Math.min(240, options.MAX_FPS)) : 60;
  CONFIG.SMOKE_ENABLED = options.SMOKE_ENABLED !== false;

  const N = CONFIG.TRAIL_LENGTH;
  const SMOKE = CONFIG.SMOKE_ENABLED;

  /* --------------------------- utils --------------------------- */

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const rgba = (color, alpha) => `rgba(${color.r.toFixed(1)},${color.g.toFixed(1)},${color.b.toFixed(1)},${alpha.toFixed(3)})`;
  const interpolate = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

  /* Resolve CSS color-mix once per palette change, never once per animation frame. */
  const fallbackPalette = [{ r: 120, g: 84, b: 205 }, { r: 59, g: 116, b: 205 }, { r: 6, g: 189, b: 201 }];
  let palette = fallbackPalette;
  let paletteKey;
  let paletteContext;
  const baseRgb = new Array(N);
  const colorStrCache = new Array(N);
  let lastTimeMs = 0;

  function syncPalette() {
    const root = document.querySelector('.monaco-workbench') || document.documentElement;
    const styles = getComputedStyle(root);
    const values = ['start', 'middle', 'end'].map(name => styles.getPropertyValue(`--customize-imports-neon-${name}`).trim());
    const key = values.join('|');
    if (key === paletteKey) return;
    paletteKey = key;
    paletteContext ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    palette = values.map((value, i) => {
      if (!value || !paletteContext || !CSS.supports('color', value)) return fallbackPalette[i];
      paletteContext.clearRect(0, 0, 1, 1);
      paletteContext.fillStyle = value;
      paletteContext.fillRect(0, 0, 1, 1);
      const [r, g, b] = paletteContext.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    });
    for (let i = 0; i < N; i++) {
      const position = i / (N - 1) * 2;
      const index = Math.min(1, Math.floor(position));
      baseRgb[i] = interpolate(palette[index], palette[index + 1], position - index);
    }
    refreshSharedColors();
  }

  /** 尾部逐渐透明；光标与所有拖尾使用同一组固定色点，避免独立色相循环漂移。 */
  function refreshSharedColors() {
    const tailStart = CONFIG.TAIL_FADE_START * (N - 1);
    const tailEnd = CONFIG.TAIL_FADE_END_ALPHA;
    for (let i = 0; i < N; i++) {
      let a = 1;
      if (i > tailStart) {
        const tailT = (i - tailStart) / (N - 1 - tailStart);
        a *= 1 - (1 - tailEnd) * Math.pow(tailT, CONFIG.TAIL_FADE_POWER);
      }
      colorStrCache[i] = rgba(baseRgb[i], a);
    }
  }

  /* --------------------------- TrailModel（per-cursor 状态） ---------------------------
   * 弹簧链：每个粒子向"后一个粒子" lerp 靠拢，形成头贴光标、尾随其后的长条。
   * 固定步长（fixed timestep）：链松弛恒以 PHYSICS_FPS 步进，与渲染刷新率解耦 →
   * 60/144/240Hz 下传播速度、拖尾长度、收尾时间完全一致（还原 trail-effect2 在 60fps 的手感）。
   */

  function createTrailModel() {
    const particles = new Array(N);
    for (let i = 0; i < N; i++) particles[i] = { x: 0, y: 0 };
    const tangents = new Array(N);
    for (let i = 0; i < N; i++) tangents[i] = { x: 1, y: 0 };

    const cursor = { x: 0, y: 0 };
    const lastCursor = { x: 0, y: 0 };
    let sizeX = 7, sizeY = 16;
    let initted = false;
    let idleSeconds = 0;
    let globalAlpha = 0;
    let physicsAccum = 0;              // 固定步长累计器（秒）
    let cursorSpeed = 0;               // 光标瞬时速度 px/s（平滑后），驱动烟雾浓度

    const smokes = SMOKE ? [] : null;
    let smokeAccum = 0;
    let lastTailX = NaN, lastTailY = NaN;

    function updateCursorSize(w, h) { sizeX = w; if (h) sizeY = h; }

    /** 全部粒子吸附到 (x,y) 并重置 idle —— move()/setImmediate() 共用 */
    function seedAt(x, y) {
      initted = true;
      for (let i = 0; i < N; i++) { particles[i].x = x; particles[i].y = y; }
      lastCursor.x = x; lastCursor.y = y;
      idleSeconds = 0;
      physicsAccum = 0;
      lastTailX = x; lastTailY = y;       // 尾尖归位，避免重种子被当成位移喷烟
    }

    function move(rawX, rawY) {
      // 以光标几何中心为参考（::after scale 从中心展开）
      const x = rawX + sizeX / 2;
      const y = rawY + sizeY / 2;
      cursor.x = x; cursor.y = y;
      // 仅在几乎不可见时重种子（首次 / 已淡出），此时 reset 无视觉断裂；
      // 不做距离阈值：让链自然把粒子从旧位置拖到新位置 → Home/End/远点击都"扫过去"
      if (!initted || globalAlpha < 0.05) seedAt(x, y);
    }

    /** 强制吸附（无视阈值）：滚动时不让光带追赶被滚动条带走的假位移。 */
    function setImmediate(rawX, rawY) {
      cursor.x = rawX + sizeX / 2;
      cursor.y = rawY + sizeY / 2;
      seedAt(cursor.x, cursor.y);
    }

    /** 一步固定步长的链松弛（与 trail-effect2 逐帧等价：x += (next-cur)*LERP）。 */
    function stepChain() {
      let x = cursor.x, y = cursor.y;
      for (let i = 0; i < N; i++) {
        const next = particles[(i + 1) % N];
        const cur = particles[i];
        cur.x = x; cur.y = y;
        x += (next.x - cur.x) * CONFIG.LERP_X;
        y += (next.y - cur.y) * CONFIG.LERP_Y;
      }
    }

    /** 推进链物理 + 切线 + idle alpha（+ 烟雾）；不绘制。
     *  固定步长累计器：物理恒以 PHYSICS_FPS 步进，渲染帧率多高/多低都跑相同步数 → 与刷新率无关。 */
    function tickPhysics(dt) {
      if (!initted) { globalAlpha = 0; return; }

      // 链松弛：把真实 dt 攒进累计器，按 1/PHYSICS_FPS 的固定步长消费整步
      const stepDt = 1 / CONFIG.PHYSICS_FPS;
      physicsAccum += clamp(dt, 0, 0.25);
      let steps = Math.floor(physicsAccum / stepDt);
      physicsAccum -= steps * stepDt;
      if (steps > CONFIG.MAX_PHYSICS_STEPS) steps = CONFIG.MAX_PHYSICS_STEPS;  // 卡顿后不追帧暴走
      for (let s = 0; s < steps; s++) stepChain();

      // 中心差分切线：法线展宽 + 头部偏移
      for (let i = 0; i < N; i++) {
        const a = particles[i === 0 ? 0 : i - 1];
        const b = particles[i === N - 1 ? N - 1 : i + 1];
        const tx = b.x - a.x, ty = b.y - a.y;
        const len = Math.hypot(tx, ty);
        if (len > 0.01) { tangents[i].x = tx / len; tangents[i].y = ty / len; }
      }
      // 静止检测 → idle 淡出 + 光标速度（驱动烟雾浓度）；均按秒，与帧率无关
      const moveX = cursor.x - lastCursor.x;
      const moveY = cursor.y - lastCursor.y;
      if (moveX !== 0 || moveY !== 0) {
        idleSeconds = 0; lastCursor.x = cursor.x; lastCursor.y = cursor.y;
      } else {
        idleSeconds += dt;
      }
      // 指数平滑速度，避免逐帧抖动；dt→0 时不更新
      if (dt > 1e-4) {
        const inst = Math.hypot(moveX, moveY) / dt;
        cursorSpeed += (inst - cursorSpeed) * clamp(dt * 12, 0, 1);
      }
      globalAlpha = clamp(1 - idleSeconds / CONFIG.IDLE_FADE_SECONDS, 0, 1);

      if (SMOKE) updateSmoke(dt);
    }

    /** 烟雾只从链尾尖喷发：背景时间率 + 尾尖位移率（跳跃时尾尖回缩划过 → 沿尾巴补喷）。
     *  浓度随光标速度提升：speedT∈[0,1] 同时放大喷发率与单颗不透明度。 */
    function updateSmoke(dt) {
      const tail = particles[N - 1];
      const distToCursor = Math.hypot(tail.x - cursor.x, tail.y - cursor.y);
      const cap = CONFIG.SMOKE_MAX_PARTICLES;

      // 速度归一化 → 浓度倍率
      const speedT = clamp(cursorSpeed / CONFIG.SMOKE_SPEED_FULL_PXS, 0, 1);
      const rateMult = 1 + (CONFIG.SMOKE_SPEED_RATE_MULT - 1) * speedT;
      const alphaMult = 1 + (CONFIG.SMOKE_SPEED_ALPHA_MULT - 1) * speedT;
      // 位移间隔随速度收缩：慢速 SMOKE_PIXELS_PER_SPAWN → 满速 SMOKE_PIXELS_PER_SPAWN_MIN（越快越密）
      const pxPerSpawn = Math.max(1, lerp(CONFIG.SMOKE_PIXELS_PER_SPAWN, CONFIG.SMOKE_PIXELS_PER_SPAWN_MIN, speedT));

      if (distToCursor < CONFIG.SMOKE_SPAWN_MIN_DIST || smokes.length >= cap) {
        smokeAccum = 0;
      } else {
        smokeAccum += CONFIG.SMOKE_SPAWN_RATE_HZ * rateMult * dt;
        if (!Number.isNaN(lastTailX)) {
          smokeAccum += Math.hypot(tail.x - lastTailX, tail.y - lastTailY) / pxPerSpawn;
        }
        while (smokeAccum >= 1 && smokes.length < cap) { smokeAccum -= 1; spawnAtTail(alphaMult); }
      }
      lastTailX = tail.x; lastTailY = tail.y;

      const drag = Math.pow(CONFIG.SMOKE_DRAG_PER_SEC, dt);   // 每秒衰减到此比例
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.age += dt;
        if (s.age >= s.life) { smokes.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= drag; s.vy *= drag;
      }
    }

    /** 在链尾尖附近喷一颗：沿法线横向 + 沿切线纵向都随机散开（避免某方向高速时挤成柱）。
     *  速度 = 随机方向 + 尾部切线 backward bias。peakMult 为速度浓度倍率，烘进该颗 peak。 */
    function spawnAtTail(peakMult) {
      const i = N - 1;
      const t = tangents[i];
      const visX = sizeX * CONFIG.CURSOR_VISUAL_X_SCALE;
      const visY = sizeY * CONFIG.CURSOR_VISUAL_Y_SCALE;
      const halfW = (visX * Math.abs(t.y) + visY * Math.abs(t.x)) * CONFIG.BAND_WIDTH_RATIO * 0.5;
      const lateral = (Math.random() * 2 - 1) * halfW;                       // 垂直运动方向
      const along = (Math.random() * 2 - 1) * halfW * CONFIG.SMOKE_ALONG_SPREAD; // 沿运动方向
      const ang = Math.random() * Math.PI * 2;
      const sp = CONFIG.SMOKE_DRIFT_SPEED * (0.6 + Math.random() * 0.8);
      const bias = CONFIG.SMOKE_BACKWARD_BIAS;
      smokes.push({
        x: particles[i].x - t.y * lateral + t.x * along,
        y: particles[i].y + t.x * lateral + t.y * along,
        vx: Math.cos(ang) * sp + t.x * bias,
        vy: Math.sin(ang) * sp + t.y * bias,
        age: 0,
        life: CONFIG.SMOKE_LIFETIME_S,
        baseR: CONFIG.SMOKE_BASE_RADIUS_PX * (0.7 + Math.random() * 0.6),
        peak: clamp(CONFIG.SMOKE_PEAK_ALPHA * peakMult, 0, 1),
      });
    }

    return {
      move, setImmediate, updateCursorSize, tickPhysics,
      get particles() { return particles; },
      get tangents() { return tangents; },
      get smokes() { return smokes; },
      get sizeX() { return sizeX; },
      get sizeY() { return sizeY; },
      get globalAlpha() { return globalAlpha; },
      // 烟雾可能在 trail idle 淡出后仍存活，需一并计入 visible
      get visible() { return initted && (globalAlpha > 0.001 || (SMOKE && smokes.length > 0)); },
    };
  }

  /* --------------------------- TrailScene（共享 canvas；shadowBlur 贴边泛光） --------------------------- */

  function createTrailScene(canvas) {
    const ctx = canvas.getContext('2d');
    let width = 0, height = 0;

    function updateSize(w, h) {
      width = w; height = h;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function clear() {
      ctx.clearRect(0, 0, width, height);
    }

    /* ---- 路径 / 几何（中心线 Catmull-Rom→Bezier；y 方向按 yScale 压缩以配合各向异性笔刷） ----
     * 头部向运动前方延长 headExt（圆头帽落在这段上），该段 alpha 渐变到 0：
     * 圆头几何仍在 → 衔接平滑无棱角，但视觉上不可见 → 可见实色从光标中心起步，融入光标。 */

    /** 头部延长信息（scaled 空间）：tip 尖点 + f0（tip→tail 上 p0 所处比例）。 */
    function headExtent(model, yScale, lineWidth) {
      const p = model.particles;
      const sx0 = p[0].x, sy0 = p[0].y / yScale;
      const sx1 = p[1].x, sy1 = p[1].y / yScale;
      let dx = sx0 - sx1, dy = sy0 - sy1;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const ext = lineWidth * 0.5 + 1;                     // 覆盖圆头帽（半径 lineWidth/2）
      const tipX = sx0 + dx * ext, tipY = sy0 + dy * ext;
      const sxT = p[N - 1].x, syT = p[N - 1].y / yScale;
      const headToTail = Math.hypot(sxT - sx0, syT - sy0) || 1;
      // f0：tip→tail 上 p0 所处比例。拖尾越短 headToTail 越小 → f0→1 → 实色段→0：
      // 占位圆头与拖尾同步收缩消失，不会在拖尾没了之后还留一个半圆。
      const f0 = clamp(ext / (ext + headToTail), 0, 1);
      return { tipX, tipY, f0 };
    }

    function traceCenterline(targetCtx, model, yScale, head) {
      const p = model.particles;
      const sy = yScale;
      targetCtx.moveTo(head.tipX, head.tipY);              // 从透明延长尖点起笔
      targetCtx.lineTo(p[0].x, p[0].y / sy);               // 直连到 p0（与 p0→p1 共线，平滑）
      for (let i = 0; i < N - 1; i++) {
        const p_1 = p[Math.max(0, i - 1)];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[Math.min(N - 1, i + 2)];
        const c1x = p1.x + (p2.x - p_1.x) / 6;
        const c1y = (p1.y + (p2.y - p_1.y) / 6) / sy;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = (p2.y - (p3.y - p1.y) / 6) / sy;
        targetCtx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y / sy);
      }
    }

    /** tip→tail 渐变：头部延长段 alpha 0 → 到 p0 处变实色 → 其后沿 colorStrCache。 */
    function makeGradient(targetCtx, model, yScale, head) {
      const p0 = model.particles[0];
      const tail = model.particles[N - 1];
      const grad = targetCtx.createLinearGradient(head.tipX, head.tipY, tail.x, tail.y / yScale);
      grad.addColorStop(0, rgba(baseRgb[0], 0));                              // 尖点透明
      const f0 = head.f0;
      grad.addColorStop(f0, colorStrCache[0]);                                // 光标中心起实色
      for (let i = 2; i < N; i += 2) grad.addColorStop(f0 + (1 - f0) * (i / (N - 1)), colorStrCache[i]);
      grad.addColorStop(1, colorStrCache[N - 1]);
      return grad;
    }

    /** 各向异性圆头笔刷沿中心线描边：
     *  block → 笔刷宽 visX、竖直拉伸到 visY（scale(1, visY/visX)）；圆头融入光标、斜向无缝、无棱角。
     *  line  → 不拉伸，细描边；本体和泛光在同一次描边中完成。 */
    function paintTrail(targetCtx, model, grad, yScale, lineWidth, head) {
      targetCtx.save();
      targetCtx.scale(1, yScale);
      targetCtx.beginPath();
      traceCenterline(targetCtx, model, yScale, head);
      targetCtx.lineWidth = lineWidth;
      targetCtx.lineJoin = 'round';
      targetCtx.lineCap = 'round';
      targetCtx.strokeStyle = grad;
      targetCtx.stroke();
      targetCtx.restore();
    }

    /** 取该 model 的笔刷参数：yScale（竖直各向异性）+ lineWidth（缩放空间内的宽度）。 */
    function brushOf(model) {
      const visX = model.sizeX * CONFIG.CURSOR_VISUAL_X_SCALE;
      const visY = model.sizeY * CONFIG.CURSOR_VISUAL_Y_SCALE;
      if (CONFIG.STYLE === 'line') {
        return { yScale: 1, lineWidth: Math.max(2, Math.min(visX, visY) * 0.5) };
      }
      const yScale = clamp(visY / visX, 0.2, 6);
      return { yScale, lineWidth: visX * CONFIG.BAND_WIDTH_RATIO };
    }

    /** 烟雾：软径向渐变圆。source-over 保留色相；每颗 peak 已含速度浓度倍率。 */
    function drawSmokeShapes(targetCtx, model) {
      const smokes = model.smokes;
      const color = baseRgb[N - 1];
      for (let i = 0; i < smokes.length; i++) {
        const s = smokes[i];
        const t = s.age / s.life;
        const alpha = (1 - t) * s.peak;
        const r = s.baseR * (1 + t * CONFIG.SMOKE_GROWTH);
        const grad = targetCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        grad.addColorStop(0, rgba(color, alpha));
        grad.addColorStop(1, rgba(color, 0));
        targetCtx.fillStyle = grad;
        targetCtx.beginPath();
        targetCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
        targetCtx.fill();
      }
    }

    /* ---- 本体和低强度泛光只描边一次，避免多遍叠亮半透明区域。 ---- */

    function drawTrailGlow(model) {
      ctx.save();
      const { yScale, lineWidth } = brushOf(model);
      // 本体可见度 = idle 淡出 × 长度淡出：拖尾收缩到≈光标尺寸时随实心条一起消失，
      // 不让占位圆头在条已没后还靠 idle/烟雾时长残留。
      const visX = model.sizeX * CONFIG.CURSOR_VISUAL_X_SCALE;
      const visY = model.sizeY * CONFIG.CURSOR_VISUAL_Y_SCALE;
      const ref = Math.max(visX, visY);
      const p = model.particles;
      const span = Math.hypot(p[N - 1].x - p[0].x, p[N - 1].y - p[0].y);
      const lengthAlpha = clamp((span - ref * 0.5) / ref, 0, 1);
      ctx.globalAlpha = model.globalAlpha * CONFIG.CORE_ALPHA * lengthAlpha;
      if (ctx.globalAlpha < 0.003) { ctx.restore(); return; }   // 条已消失：跳过（烟雾在别处单独画）
      const head = headExtent(model, yScale, lineWidth);
      const grad = makeGradient(ctx, model, yScale, head);
      ctx.shadowColor = rgba(palette[1], CONFIG.GLOW_ALPHA);
      ctx.shadowBlur = CONFIG.GLOW_BLUR_PX;
      paintTrail(ctx, model, grad, yScale, lineWidth, head);
      ctx.restore();
    }

    function drawTrailGlowSmoke(model) {
      drawTrailGlow(model);
      if (model.smokes.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = model.globalAlpha;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        drawSmokeShapes(ctx, model);
        ctx.restore();
      }
    }

    return {
      updateSize,
      clear,
      drawTrail: SMOKE ? drawTrailGlowSmoke : drawTrailGlow,
    };
  }

  /* Shared canvas; cursor discovery continues at low frequency while drawing is idle. */
  let scene = null;
  let canvas = null;
  const trails = new Map();
  const removers = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let isScrolling = false;
  let scrollResetTimeout = null;
  let scanTimer = null;
  let isFocused = document.hasFocus();
  let rafId = null;
  const minFrameMs = 1000 / CONFIG.MAX_FPS;
  let lastDrawMs = 0;

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }

  function syncCursor(data) {
    const { target, model } = data;
    const cs = getComputedStyle(target);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || (rect.left === data.lastX && rect.top === data.lastY)) return false;
    model.updateCursorSize(rect.width, rect.height);
    if (isScrolling) model.setImmediate(rect.left, rect.top);
    else model.move(rect.left, rect.top);
    data.lastX = rect.left; data.lastY = rect.top;
    return true;
  }

  function scanCursors() {
    if (disposed || !isFocused || document.hidden || reducedMotion.matches) return;
    syncPalette();
    const seen = new Set();
    let changed = false;
    for (const target of document.querySelectorAll('.monaco-editor .cursor')) {
      if (seen.size >= 64) break;
      seen.add(target);
      if (!trails.has(target)) trails.set(target, { model: createTrailModel(), target, lastX: NaN, lastY: NaN });
      changed = syncCursor(trails.get(target)) || changed;
    }
    for (const target of trails.keys()) if (!seen.has(target)) trails.delete(target);
    if (changed) startAnimation();
    if (!trails.size) { stopAnimation(); scene?.clear(); }
  }

  function animate(nowMs) {
    rafId = null;
    if (disposed || !isFocused || document.hidden || reducedMotion.matches || !scene) return;
    if (lastDrawMs && nowMs - lastDrawMs < minFrameMs) { rafId = requestAnimationFrame(animate); return; }
    const dt = lastTimeMs ? Math.min((nowMs - lastTimeMs) / 1000, 0.25) : 0;
    lastTimeMs = nowMs; lastDrawMs = nowMs;
    let anyVisible = false;
    for (const data of trails.values()) {
      syncCursor(data);
      data.model.tickPhysics(dt);
      if (data.model.visible) anyVisible = true;
    }
    scene.clear();
    if (!anyVisible) return;
    for (const data of trails.values()) if (data.model.visible) scene.drawTrail(data.model);
    rafId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (rafId === null && !disposed && isFocused && !document.hidden && !reducedMotion.matches) {
      syncPalette();
      lastTimeMs = 0; lastDrawMs = 0;
      rafId = requestAnimationFrame(animate);
    }
  }
  function stopAnimation() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null; lastTimeMs = 0; lastDrawMs = 0;
  }
  function updateCanvasSize() { scene?.updateSize(window.innerWidth, window.innerHeight); }
  function focusChanged() {
    isFocused = document.hasFocus();
    if (isFocused && !document.hidden && !reducedMotion.matches) { scanCursors(); startAnimation(); }
    else { stopAnimation(); scene?.clear(); }
  }
  function bootstrap() {
    if (disposed) return;
    canvas = document.createElement('canvas');
    canvas.id = 'customize-imports-cursor-trail';
    Object.assign(canvas.style, { pointerEvents: 'none', position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', zIndex: '9999' });
    document.body.appendChild(canvas);
    scene = createTrailScene(canvas);
    updateCanvasSize();
    listen(window, 'resize', updateCanvasSize);
    listen(document, 'scroll', () => {
      isScrolling = true;
      clearTimeout(scrollResetTimeout);
      scrollResetTimeout = setTimeout(() => { isScrolling = false; }, 100);
    }, { capture: true, passive: true });
    listen(window, 'focus', focusChanged);
    listen(window, 'blur', () => { isFocused = false; stopAnimation(); scene?.clear(); });
    listen(document, 'visibilitychange', focusChanged);
    listen(reducedMotion, 'change', focusChanged);
    listen(document, 'keydown', startAnimation, true);
    listen(document, 'pointerup', () => { scanCursors(); startAnimation(); }, true);
    scanTimer = setInterval(scanCursors, CONFIG.CURSOR_POLLING_MS);
    syncPalette();
    scanCursors();
  }
  const api = {
    getStats: () => ({ cursors: trails.size, animating: rafId !== null, maxFPS: CONFIG.MAX_FPS, disposed,
      palette: palette.map(color => ({ ...color })) }),
    dispose() {
      disposed = true;
      stopAnimation();
      clearInterval(scanTimer);
      clearTimeout(scrollResetTimeout);
      removers.splice(0).forEach(remove => remove());
      trails.clear();
      canvas?.remove(); canvas = null; scene = null;
      if (window.vscodeCursorTrail === api) delete window.vscodeCursorTrail;
    },
  };
  window.vscodeCursorTrail = api;
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
