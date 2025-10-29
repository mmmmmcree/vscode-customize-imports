const Color = "#FFFFFF"
const CursorStyle = "block"
const TrailLength = 24
const CursorUpdatePollingRate = 50
const UseShadow = true
const ShadowColor = Color
const ShadowBlur = 15
let XmovingDirection = 1;
let YmovingDirection = 1;

function createTrail(options) {
const totalParticles = options?.length || 20
let particlesColors = []
const style = options?.style || "block"
const canvas = options?.canvas
const context = canvas.getContext("2d")
let cursor = { x: 0, y: 0 }
let particles = []
let width, height
let sizeX = options?.size || 3
let sizeY = options?.sizeY || sizeX * 2.2
let cursorsInitted = false
let hueOffset = 0
const startColor = { r: 103, g: 250, b: 243 };
const endColor = { r: 182, g: 110, b: 255 };

function interpolateColor(color1, color2, factor) {
  const r = Math.round(color1.r + factor * (color2.r - color1.r));
  const g = Math.round(color1.g + factor * (color2.g - color1.g));
  const b = Math.round(color1.b + factor * (color2.b - color1.b));
  return `rgb(${r}, ${g}, ${b})`;
}

function initializeParticleColors() {
  particlesColors = [];
  for (let i = 0; i < totalParticles; i++) {
    const factor = i / (totalParticles - 1);
    particlesColors.push(interpolateColor(startColor, endColor, factor));
  }
}

function updateRainbowColors() {
  hueOffset = (hueOffset + 0.5) % 360;
  const shiftedStartColor = shiftColorHue(startColor, hueOffset);
  const shiftedEndColor = shiftColorHue(endColor, hueOffset);
  for (let i = 0; i < totalParticles; i++) {
    const factor = i / (totalParticles - 1);
    particlesColors[i] = interpolateColor(shiftedStartColor, shiftedEndColor, factor);
  }
}

function shiftColorHue(color, hueShift) {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  const newHue = (h + hueShift) % 360;
  const { r, g, b } = hslToRgb(newHue, s, l);
  return { r, g, b };
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    
    r = hue2rgb(p, q, (h / 360 + 1/3) % 1);
    g = hue2rgb(p, q, (h / 360) % 1);
    b = hue2rgb(p, q, (h / 360 - 1/3) % 1);
  }
  
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

function updateSize(x, y) {
  width = x
  height = y
  canvas.width = x
  canvas.height = y
}

function move(x, y) {
  x = x + sizeX / 2
  cursor.x = x
  cursor.y = y
  if (cursorsInitted === false) {
    cursorsInitted = true
    initializeParticleColors()
    for (let i = 0; i < totalParticles; i++) {
      addParticle(x, y)
    }
  }
}

class Particle {
  constructor(x, y) {
    this.position = { x: x, y: y }
  }
}

function addParticle(x, y, image) {
  particles.push(new Particle(x, y, image))
}

function calculatePosition() {
  let x = cursor.x, y = cursor.y
  for (const particleIndex in particles) {
    const nextParticlePos = (particles[+particleIndex + 1] || particles[0]).position
    const particlePos = particles[+particleIndex].position
    particlePos.x = x;
    particlePos.y = y;
    delta_x = (nextParticlePos.x - particlePos.x) * 0.42
    delta_y = (nextParticlePos.y - particlePos.y) * 0.35
    x += delta_x
    y += delta_y
    if (delta_y != 0) { XmovingDirection = 0 }
    else { XmovingDirection = (delta_x > 0) ? -1 : 1 }
    if (delta_x != 0) { YmovingDirection = 0 }
    else { YmovingDirection = (delta_y > 0) ? -1 : 1 }
  }
}

function drawLines() {
  const fixedLineWidth = 7
  let x_offset = sizeX * 0.45 * XmovingDirection
  let y_offset = sizeY * 0.3 * YmovingDirection
  const lineHeight = sizeY
  let ymut = lineHeight / 12
  for (let yoffset = 1; yoffset < 12; yoffset++) {
    let offset = yoffset * ymut
    for (let particleIndex = 0; particleIndex < particles.length - 1; particleIndex++) {
      context.beginPath()
      context.lineJoin = "round"
      context.strokeStyle = particlesColors[particleIndex]
      context.lineWidth = fixedLineWidth
      if (UseShadow) {
        context.shadowColor = particlesColors[particleIndex]
        context.shadowBlur = ShadowBlur
      }
      const pos = particles[particleIndex].position
      const nextPos = particles[particleIndex + 1].position
      context.moveTo(pos.x + x_offset, pos.y + offset + y_offset)
      context.lineTo(nextPos.x + x_offset, nextPos.y + offset + y_offset)
      context.stroke()
    }
  }
}

function drawPath() {
  context.beginPath()
  if (UseShadow) {
    context.shadowColor = ShadowColor;
    context.shadowBlur = ShadowBlur;
  }
  for (let particleIndex=0;particleIndex<totalParticles;particleIndex++) {
    context.fillStyle = particlesColors[particleIndex]
    context.strokeStyle = particlesColors[particleIndex]
    const pos = particles[+particleIndex].position
    if (particleIndex == 0) {
      context.moveTo(pos.x, pos.y)
    } else {
      context.lineTo(pos.x, pos.y)
    }
  }
  for (let particleIndex=totalParticles-1;particleIndex>=0;particleIndex--) {
    const pos = particles[+particleIndex].position
    context.lineTo(pos.x, pos.y+sizeY)
  }
  context.closePath()
  context.fill()
  context.beginPath()
  context.lineJoin = "round"
  context.lineWidth = 7
  let x_offset = sizeX * 0.45 * XmovingDirection
  let y_offset = sizeY * 0.3 * YmovingDirection
  let offset = -sizeX/2 + sizeY/2
  for (const particleIndex in particles) {
    const pos = particles[particleIndex].position
    if (particleIndex == 0) {
      context.moveTo(pos.x + x_offset, pos.y + offset + y_offset)
    } else {
      context.lineTo(pos.x + x_offset, pos.y + offset + y_offset)
    }
  }
  context.stroke()
}

function updateParticles() {
  if (!cursorsInitted) return
  context.clearRect(0, 0, width, height)
  calculatePosition()
  updateRainbowColors()
  if (style == "line") drawPath()
  else if (style == "block") drawLines()
}

function updateCursorSize(newSize, newSizeY) {
  sizeX = newSize
  if (newSizeY) sizeY = newSizeY
}

return {
  updateParticles: updateParticles,
  move: move,
  updateSize: updateSize,
  updateCursorSize: updateCursorSize
}
}

async function createCursorHandler(handlerFunctions) {
let editor
while (!editor) {
  await new Promise(resolve => setTimeout(resolve, 100))
  editor = document.querySelector(".part.editor")
}
handlerFunctions?.onStarted(editor)

let updateHandlers = []
let cursorId = 0
let lastObjects = {}
let lastCursor = 0
let isWindowFocused = document.hasFocus(); // 添加焦点状态标记
let animationFrameId = null; // 保存 requestAnimationFrame ID

function createCursorUpdateHandler(target, cursorId, cursorHolder, minimap) {
  let lastX, lastY
  let update = (editorX, editorY) => {
    if (!lastObjects[cursorId]) {
      updateHandlers.splice(updateHandlers.indexOf(update), 1)
      return
    }
    let { left: newX, top: newY } = target.getBoundingClientRect()
    let revX = newX - editorX, revY = newY - editorY
    if (revX == lastX && revY == lastY && lastCursor == cursorId) return
    lastX = revX; lastY = revY
    if (revX <= 0 || revY <= 0) return
    if (target.style.visibility == "hidden") return
    if (minimap && minimap.offsetWidth != 0 && minimap.getBoundingClientRect().left <= newX) return
    if (cursorHolder.getBoundingClientRect().left > newX) return
    lastCursor = cursorId
    handlerFunctions?.onCursorPositionUpdated(revX, revY)
    handlerFunctions?.onCursorSizeUpdated(target.clientWidth, target.clientHeight)
  }
  updateHandlers.push(update)
}

let lastVisibility = "hidden"
setInterval(async () => {
  let now = [], count = 0
  for (const target of editor.getElementsByClassName("cursor")) {
    if (target.style.visibility != "hidden") count++
    if (target.hasAttribute("cursorId")) {
      now.push(+target.getAttribute("cursorId"))
      continue
    }
    let thisCursorId = cursorId++
    now.push(thisCursorId)
    lastObjects[thisCursorId] = target
    target.setAttribute("cursorId", thisCursorId)
    let cursorHolder = target.parentElement.parentElement.parentElement
    let minimap = cursorHolder.parentElement.querySelector(".minimap")
    createCursorUpdateHandler(target, thisCursorId, cursorHolder, minimap)
  }
  let visibility = count <= 1 ? "visible" : "hidden"
  if (visibility != lastVisibility) {
    handlerFunctions?.onCursorVisibilityChanged(visibility)
    lastVisibility = visibility
  }
  for (const id in lastObjects) {
    if (now.includes(+id)) continue
    delete lastObjects[+id]
  }
}, handlerFunctions?.cursorUpdatePollingRate || 500)

function updateLoop() {
  // 只在窗口获得焦点时才执行动画
  if (!isWindowFocused) {
    animationFrameId = null;
    return;
  }
  
  let { left: editorX, top: editorY } = editor.getBoundingClientRect()
  for (handler of updateHandlers) handler(editorX, editorY)
  handlerFunctions?.onLoop()
  animationFrameId = requestAnimationFrame(updateLoop)
}

function startAnimation() {
  if (animationFrameId === null && isWindowFocused) {
    updateLoop();
  }
}

function stopAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// 监听窗口焦点事件
window.addEventListener('focus', () => {
  isWindowFocused = true;
  startAnimation();
});

window.addEventListener('blur', () => {
  isWindowFocused = false;
  stopAnimation();
});

function updateEditorSize() {
  handlerFunctions?.onEditorSizeUpdated(editor.clientWidth, editor.clientHeight)
}
new ResizeObserver(updateEditorSize).observe(editor)
updateEditorSize()

// 启动动画循环（只有窗口获得焦点时才会真正运行）
startAnimation();
handlerFunctions?.onReady()
}

let cursorCanvas, rainbowCursorHandle
createCursorHandler({
cursorUpdatePollingRate: CursorUpdatePollingRate,
onStarted: (editor) => {
  cursorCanvas = document.createElement("canvas")
  cursorCanvas.style.pointerEvents = "none"
  cursorCanvas.style.position = "absolute"
  cursorCanvas.style.top = "0px"
  cursorCanvas.style.left = "0px"
  cursorCanvas.style.zIndex = "1000"
  editor.appendChild(cursorCanvas)

  rainbowCursorHandle = createTrail({
    length: TrailLength,
    size: 7,
    style: CursorStyle,
    canvas: cursorCanvas
  })
},
onReady: () => { },
onCursorPositionUpdated: (x, y) => {
  rainbowCursorHandle.move(x, y)
},
onEditorSizeUpdated: (x, y) => {
  rainbowCursorHandle.updateSize(x, y)
},
onCursorSizeUpdated: (x, y) => {
  rainbowCursorHandle.updateCursorSize(x, y)
},
onCursorVisibilityChanged: (visibility) => {
  cursorCanvas.style.visibility = visibility
},
onLoop: () => {
  rainbowCursorHandle.updateParticles()
},
})