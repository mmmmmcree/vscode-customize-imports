'use strict';/* ============================================================================
 * VSCode Cursor Trail + Smoke（custom-css 注入）
 *   - 弹簧链跟随：头粗尾细的长条光带（还原 77caafe 形态）
 *   - Catmull-Rom→Bezier 平滑 + shadowBlur 贴边泛光（trail-effect2 风格，单次填充不过曝）
 *   - 物理基于固定步长：任意刷新率手感一致，高刷下拖尾不会瞬间收尾
 *   - 烟雾只从链尾尖喷发，浓度随光标速度提升，绝不出现在拖尾中段
 *   - 视口级 fixed canvas
 *
 * 与 vscode-custom.css 的一致性约束：
 *   START/END_COLOR_HSL       ↔ div.cursor 的 linear-gradient
 *   CURSOR_VISUAL_X/Y_SCALE   ↔ div.cursor::after 的 transform: scale
 * ========================================================================== */

(() => {
  /* --------------------------- CONFIG --------------------------- */
  const CONFIG = {
    TRAIL_LENGTH: 24,                  // 链粒子数（拖尾长度旋钮之一：越多越长）
    STYLE: 'block',                    // 'block' | 'line'
    CURSOR_POLLING_MS: 150,            // 轮询 .cursor 节点出现/消失

    // 帧率解耦（固定步长：物理恒以 PHYSICS_FPS 步进，渲染跟显示器 → 任意刷新率手感一致）
    PHYSICS_FPS: 60,                   // 链松弛步进频率。60 = 还原 trail-effect2 在 60fps 下的手感
    MAX_PHYSICS_STEPS: 6,              // 单帧最多补几步（防长卡顿后"追帧"暴走 / spiral of death）
    MAX_FPS: 0,                        // 渲染封顶；0 = 跟随显示器 rAF。>0（如 60）可在高刷屏限帧省电
    COLOR_REFRESH_HZ: 30,              // 色串刷新频率（与渲染帧率解耦）

    // 颜色（HSL，避免 per-frame RGB↔HSL）；与 div.cursor 渐变同源
    START_COLOR_HSL: { h: 177, s: 93, l: 69 },   // ≈ rgb(103,250,243)
    END_COLOR_HSL:   { h: 266, s: 100, l: 72 },  // ≈ rgb(182,110,255)
    HUE_SPEED_DEG_PER_SEC: 30,

    // 几何（宽度沿运动法线展开；含 ::after scale 放大以对齐发光块）
    CURSOR_VISUAL_X_SCALE: 1.4,
    CURSOR_VISUAL_Y_SCALE: 1.2,
    BAND_WIDTH_RATIO: 1.0,
    HEAD_FADE_PARTICLES: 3,            // 前 N 粒子 alpha 渐入 + 几何收口，柔化与光标衔接
    TAIL_FADE_START: 0.55,             // 轨迹比例，超过此处尾部 alpha 渐隐（长条"溶解"收口）
    TAIL_FADE_POWER: 2.5,
    TAIL_FADE_END_ALPHA: 0.0,
    IDLE_FADE_SECONDS: 1.5,            // 静止超过该秒数后整条光带（含泛光）淡出

    // 泛光（trail-effect2 风格：canvas shadowBlur 贴边发光）
    // source-over 单次填充：shadow 画在形状下方，本体不被叠加 → 不会过曝发白
    GLOW_BLUR_PX: 20,                  // 发光扩散半径
    GLOW_PASSES: 2,                    // 发光遍数（越多光晕越浓；本体颜色不变）
    CORE_ALPHA: 1.0,                   // 主光带不透明度；逐光标 idle 淡出另在 globalAlpha 叠加

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
    SMOKE_PEAK_ALPHA: 0.5,            // 烟雾中心不透明度（'lighter' 叠加的可见"核"）
    SMOKE_ALONG_SPREAD: 1.0,         // 沿运动方向的随机散布（×法向宽度）：打散高速时的"烟雾柱"，0=只横向
    // 浓度随光标速度（越快越浓：喷发率 + 不透明度同时提升）
    SMOKE_SPEED_FULL_PXS: 1000,      // 光标速度达此值(px/s)时浓度倍率到最大
    SMOKE_SPEED_RATE_MULT: 6,        // 满速时喷发率倍率上限
    SMOKE_SPEED_ALPHA_MULT: 1.1,     // 满速时不透明度倍率上限
  };

  const N = CONFIG.TRAIL_LENGTH;
  const SMOKE = CONFIG.SMOKE_ENABLED;

  /* --------------------------- utils --------------------------- */

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** HSL 插值（角度走最短路径） */
  function lerpHsl(c1, c2, t) {
    const dh = ((c2.h - c1.h + 540) % 360) - 180;
    return { h: (c1.h + dh * t + 360) % 360, s: lerp(c1.s, c2.s, t), l: lerp(c1.l, c2.l, t) };
  }
  const hsla = (h, s, l, a) =>
    `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a.toFixed(3)})`;

  /* ---- 共享：色相 / alpha 缓存（只取决于 i/N，与具体光标无关） ---- */

  const baseHsl = new Array(N);
  for (let i = 0; i < N; i++) baseHsl[i] = lerpHsl(CONFIG.START_COLOR_HSL, CONFIG.END_COLOR_HSL, i / (N - 1));

  const colorStrCache = new Array(N).fill('hsla(0,0%,100%,1)');
  let hueOffset = 0;
  let lastTimeMs = 0;
  let colorAccum = 0;                 // 色串刷新时间累计

  /** 尾部 alpha 渐隐 + 当前 hueOffset；头部保持实心（与光标 startColor 无缝衔接，不渐入）。
   *  逐光标 idle 淡出在渲染时叠加。 */
  function refreshSharedColors() {
    const tailStart = CONFIG.TAIL_FADE_START * (N - 1);
    const tailEnd = CONFIG.TAIL_FADE_END_ALPHA;
    for (let i = 0; i < N; i++) {
      const c = baseHsl[i];
      const h = (c.h + hueOffset) % 360;
      let a = 1;
      if (i > tailStart) {
        const tailT = (i - tailStart) / (N - 1 - tailStart);
        a *= 1 - (1 - tailEnd) * Math.pow(tailT, CONFIG.TAIL_FADE_POWER);
      }
      colorStrCache[i] = hsla(h, c.s, c.l, a);
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
      canvas.width = w; canvas.height = h;
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
      const c0 = baseHsl[0];
      grad.addColorStop(0, hsla((c0.h + hueOffset) % 360, c0.s, c0.l, 0));   // 尖点透明
      const f0 = head.f0;
      grad.addColorStop(f0, colorStrCache[0]);                                // 光标中心起实色
      for (let i = 2; i < N; i += 2) grad.addColorStop(f0 + (1 - f0) * (i / (N - 1)), colorStrCache[i]);
      grad.addColorStop(1, colorStrCache[N - 1]);
      return grad;
    }

    /** 各向异性圆头笔刷沿中心线描边：
     *  block → 笔刷宽 visX、竖直拉伸到 visY（scale(1, visY/visX)）；圆头融入光标、斜向无缝、无棱角。
     *  line  → 不拉伸，细描边。glow 会带 shadow 多次调用本函数。 */
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

    /** 烟雾：软径向渐变圆。'lighter' 叠加；每颗 peak 已含速度浓度倍率。 */
    function drawSmokeShapes(targetCtx, model) {
      const smokes = model.smokes;
      const c = baseHsl[N - 1];
      const h = (c.h + hueOffset) % 360;
      const baseColor = `${h.toFixed(0)}, ${c.s.toFixed(0)}%, ${c.l.toFixed(0)}%`;
      for (let i = 0; i < smokes.length; i++) {
        const s = smokes[i];
        const t = s.age / s.life;
        const alpha = (1 - t) * s.peak;
        const r = s.baseR * (1 + t * CONFIG.SMOKE_GROWTH);
        const grad = targetCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        grad.addColorStop(0, `hsla(${baseColor}, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, `hsla(${baseColor}, 0)`);
        targetCtx.fillStyle = grad;
        targetCtx.beginPath();
        targetCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
        targetCtx.fill();
      }
    }

    /* ---- 渲染：单次 source-over 填充 + shadowBlur 贴边泛光 ----
     * shadow 由同一次 fill 投在形状外圈，本体不被二次叠加 → 不会过曝发白。
     * GLOW_PASSES 多遍只加厚 shadow 光晕（每遍 shadowColor 带 alpha），本体颜色稳定。 */

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
      // 阴影发光遍：本体颜色不变，只靠 shadow 在形状外圈叠出光晕
      if (CONFIG.GLOW_BLUR_PX > 0 && CONFIG.GLOW_PASSES > 0) {
        const c = baseHsl[Math.floor(N / 2)];
        ctx.shadowColor = hsla((c.h + hueOffset) % 360, c.s, c.l, 1);
        ctx.shadowBlur = CONFIG.GLOW_BLUR_PX;
        for (let pass = 0; pass < CONFIG.GLOW_PASSES; pass++) paintTrail(ctx, model, grad, yScale, lineWidth, head);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }
      // 本体（无阴影）一次描边，颜色干净不过曝
      paintTrail(ctx, model, grad, yScale, lineWidth, head);
      ctx.restore();
    }

    function drawTrailGlowSmoke(model) {
      drawTrailGlow(model);
      if (model.smokes.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
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

  /* --------------------------- bootstrap ---------------------------
   * canvas 挂 document.body，fixed + 100vw×100vh 视口绝对坐标，不受 split/布局影响。
   * 抓取 '.monaco-editor .cursor'，覆盖所有编辑器组与 diff 两侧。
   */

  let scene = null;
  /** Map<cursorId, { model, target, lastX, lastY }> */
  const trails = new Map();
  let isScrolling = false;
  let scrollResetTimeout = null;
  let isFocused = document.hasFocus();
  let rafId = null;
  const minFrameMs = CONFIG.MAX_FPS > 0 ? 1000 / CONFIG.MAX_FPS : 0;
  let lastDrawMs = 0;

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

    // 滚动是"屏幕动而 cursor 没动"，链跟随会画假拖尾，需屏蔽
    document.addEventListener('scroll', () => {
      isScrolling = true;
      clearTimeout(scrollResetTimeout);
      scrollResetTimeout = setTimeout(() => { isScrolling = false; }, 100);
    }, { capture: true, passive: true });

    window.addEventListener('focus', () => { isFocused = true; startAnimation(); });
    window.addEventListener('blur', () => {
      isFocused = false; stopAnimation(); if (scene) scene.clear();
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
        if (rect.width > 0 && rect.height > 0) model.updateCursorSize(rect.width, rect.height);
        trails.set(id, { model, target, lastX: NaN, lastY: NaN });
      }
    });
    for (const id of trails.keys()) if (!seen.has(id)) trails.delete(id);
  }

  function animate(nowMs) {
    if (!isFocused) { rafId = null; return; }
    rafId = requestAnimationFrame(animate);
    if (!scene) return;

    // MAX_FPS 限帧：跳过本次绘制但不累计 dt（下次用真实间隔）
    if (minFrameMs && lastDrawMs && nowMs - lastDrawMs < minFrameMs) return;

    const dt = lastTimeMs ? (nowMs - lastTimeMs) / 1000 : 0;
    lastTimeMs = nowMs;
    lastDrawMs = nowMs;
    hueOffset = (hueOffset + dt * CONFIG.HUE_SPEED_DEG_PER_SEC) % 360;

    let anyVisible = false;
    for (const data of trails.values()) {
      const { model, target } = data;
      const cs = getComputedStyle(target);
      // 不可见（visibility/display/opacity）→ 跳过位置同步，物理仍推进让其自然淡出
      if (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0') {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 &&
            (rect.left !== data.lastX || rect.top !== data.lastY)) {
          model.updateCursorSize(rect.width, rect.height);
          if (isScrolling) model.setImmediate(rect.left, rect.top);   // 滚动硬重置
          else model.move(rect.left, rect.top);
          data.lastX = rect.left;
          data.lastY = rect.top;
        }
      }
      model.tickPhysics(dt);
      if (model.visible) anyVisible = true;
    }

    if (!anyVisible) { scene.clear(); return; }

    // 色串刷新时间节流（与渲染帧率解耦）
    colorAccum += dt;
    if (colorAccum >= 1 / CONFIG.COLOR_REFRESH_HZ) { colorAccum = 0; refreshSharedColors(); }

    scene.clear();
    for (const data of trails.values()) if (data.model.visible) scene.drawTrail(data.model);
  }

  function startAnimation() {
    if (rafId === null && isFocused) rafId = requestAnimationFrame(animate);
  }
  function stopAnimation() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();