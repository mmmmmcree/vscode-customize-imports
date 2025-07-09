const Color = "#FFFFFF" // If set to "default," it will use the theme's cursor color.
const CursorStyle = "block" // Options are 'line' or 'block'
const TrailLength = 24 // Recommended value is around 8
const CursorUpdatePollingRate = 3 // Recommended value is around 500
const UseShadow = true
const ShadowColor = Color
const ShadowBlur = 15
let XmovingDirection = 1; // -1表示向右，1表示向左，0表示仅y轴出现偏移
let YmovingDirection = 1; //-1表示向下，1表示向上，0表示仅x轴出现偏移

function createTrail(options) {
const totalParticles = options?.length || 20
let particlesColors = [] // Array to store colors for each particle
const style = options?.style || "block"
const canvas = options?.canvas
const context = canvas.getContext("2d")
let cursor = { x: 0, y: 0 }
let particles = []
let width, height
let sizeX = options?.size || 3
let sizeY = options?.sizeY || sizeX * 2.2
let cursorsInitted = false
let hueOffset = 0 // For rainbow animation
const startColor = { r: 103, g: 250, b: 243 }; // 浅蓝色
const endColor = { r: 182, g: 110, b: 255 };   // 紫色
function interpolateColor(color1, color2, factor) {
  const r = Math.round(color1.r + factor * (color2.r - color1.r));
  const g = Math.round(color1.g + factor * (color2.g - color1.g));
  const b = Math.round(color1.b + factor * (color2.b - color1.b));
  return `rgb(${r}, ${g}, ${b})`;
}
function initializeParticleColors() {
  particlesColors = [];
  for (let i = 0; i < totalParticles; i++) {
    // 计算插值因子 (0 到 1 之间)
    const factor = i / (totalParticles - 1);
    particlesColors.push(interpolateColor(startColor, endColor, factor));
  }
}
// 带动画效果的颜色更新
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
  // 将RGB转换为HSL，修改色相，然后转换回RGB
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  const newHue = (h + hueShift) % 360;
  const { r, g, b } = hslToRgb(newHue, s, l);
  return { r, g, b };
}

// RGB转HSL的辅助函数
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0; // 灰色
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
// HSL转RGB的辅助函数
function hslToRgb(h, s, l) {
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l; // 灰色
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
    // for up&down
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

// Update rainbow colors
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
function createCursorUpdateHandler(target, cursorId, cursorHolder, minimap) {
let lastX, lastY // save last position
let update = (editorX, editorY) => {
if (!lastObjects[cursorId]) {
updateHandlers.splice(updateHandlers.indexOf(update), 1)
return
}
let { left: newX, top: newY } = target.getBoundingClientRect()
let revX = newX - editorX, revY = newY - editorY
if (revX == lastX && revY == lastY && lastCursor == cursorId) return
lastX = revX; lastY = revY // update last position
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
let { left: editorX, top: editorY } = editor.getBoundingClientRect()
for (handler of updateHandlers) handler(editorX, editorY)
handlerFunctions?.onLoop()
requestAnimationFrame(updateLoop)
}
function updateEditorSize() {
handlerFunctions?.onEditorSizeUpdated(editor.clientWidth, editor.clientHeight)
}
new ResizeObserver(updateEditorSize).observe(editor)
updateEditorSize()
updateLoop()
handlerFunctions?.onReady()
}

let cursorCanvas, rainbowCursorHandle
createCursorHandler({
cursorUpdatePollingRate: CursorUpdatePollingRate,
onStarted: (editor) => {
// create new canvas for make animation
cursorCanvas = document.createElement("canvas")
cursorCanvas.style.pointerEvents = "none"
cursorCanvas.style.position = "absolute"
cursorCanvas.style.top = "0px"
cursorCanvas.style.left = "0px"
cursorCanvas.style.zIndex = "1000"
editor.appendChild(cursorCanvas)

// Color parameter is ignored since we're using rainbow colors
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

// https://www.reddit.com/r/vscode/comments/11e66xh/i_made_neovide_alike_cursor_effect_on_vscode/

// Configuration

// Set the color of the cursor trail to match the user's cursor color
// const Color = "#A052FF" // If set to "default," it will use the theme's cursor color.
// const CursorStyle = "line" // Options are 'line' or 'block'
// const TrailLength = 32 // Recommended value is around 8
// const CursorUpdatePollingRate = 500 // Recommended value is around 500
// const UseShadow = false
// const ShadowColor = Color
// const ShadowBlur = 15

// // imported from https://github.com/tholman/cursor-effects/blob/master/src/rainbowCursor.js
// function createTrail(options) {
//   const totalParticles = options?.length || 20
//   let particlesColor = options?.color || "#A052FF"
//   const style = options?.style || "block"
//   const canvas = options?.canvas
//   const context = canvas.getContext("2d")
//   let cursor = { x: 0, y: 0 }
//   let particles = []
//   let width,height
//   let sizeX = options?.size || 3
//   let sizeY = options?.sizeY || sizeX*2.2
//   let cursorsInitted = false

//   // update canvas size
//   function updateSize(x,y) {
//     width = x
//     height = y
//     canvas.width = x
//     canvas.height = y
//   }

//   // update cursor position
//   function move(x,y) {
//     x = x + sizeX/2
//     cursor.x = x
//     cursor.y = y
//     if (cursorsInitted === false) {
//       cursorsInitted = true
//       for (let i = 0; i < totalParticles; i++) {
//         addParticle(x, y)
//       }
//     }
//   }

//   // particle class
//   class Particle {
//     constructor(x, y) {
//       this.position = { x: x, y: y }
//     }
//   }

//   function addParticle(x, y, image) {
//     particles.push(new Particle(x, y, image))
//   }

//   function calculatePosition() {
//     let x = cursor.x,y = cursor.y

//     for (const particleIndex in particles) {
//       const nextParticlePos = (particles[+particleIndex + 1] || particles[0]).position
//       const particlePos = particles[+particleIndex].position

//       particlePos.x = x;
//       particlePos.y = y;
      
//       x += (nextParticlePos.x - particlePos.x) * 0.42
//       y += (nextParticlePos.y - particlePos.y) * 0.35
//     }
//   }

//   // for block cursor
//   function drawLines() {
//     context.beginPath()
//     context.lineJoin = "round"
//     context.strokeStyle = particlesColor
//     const lineWidth = Math.min(sizeX,sizeY)
//     context.lineWidth = lineWidth

//     if (UseShadow) {
//       context.shadowColor = ShadowColor;
//       context.shadowBlur = ShadowBlur;
//     }

//     // draw 3 lines
//     let ymut = (sizeY-lineWidth)/3
//     for (let yoffset=0;yoffset<=3;yoffset++) {
//       let offset = yoffset*ymut
//       for (const particleIndex in particles) {
//         const pos = particles[particleIndex].position
//         if (particleIndex == 0) {
//           context.moveTo(pos.x, pos.y + offset + lineWidth/2)
//         } else {
//           context.lineTo(pos.x, pos.y + offset + lineWidth/2)
//         }
//       }
//     }
//     context.stroke()
//   }

//   // for line cursor
//   function drawPath() {
//     context.beginPath()
//     context.fillStyle = particlesColor
//     if (UseShadow) {
//       context.shadowColor = ShadowColor;
//       context.shadowBlur = ShadowBlur;
//     }
//     // draw path
//     for (let particleIndex=0;particleIndex<totalParticles;particleIndex++) {
//       const pos = particles[+particleIndex].position
//       if (particleIndex == 0) {
//         context.moveTo(pos.x, pos.y)
//       } else {
//         context.lineTo(pos.x, pos.y)
//       }
//     }
//     for (let particleIndex=totalParticles-1;particleIndex>=0;particleIndex--) {
//       const pos = particles[+particleIndex].position
//       context.lineTo(pos.x, pos.y+sizeY)
//     }
//     context.closePath()
//     context.fill()

//     context.beginPath()
//     context.lineJoin = "round"
//     context.strokeStyle = particlesColor
//     context.lineWidth = Math.min(sizeX,sizeY)
//     // for up&down
//     let offset = -sizeX/2 + sizeY/2
//     for (const particleIndex in particles) {
//       const pos = particles[particleIndex].position
//       if (particleIndex == 0) {
//         context.moveTo(pos.x, pos.y + offset)
//       } else {
//         context.lineTo(pos.x, pos.y + offset)
//       }
//     }
//     context.stroke()
//   }

//   function updateParticles() {
//     if (!cursorsInitted) return

//     context.clearRect(0, 0, width, height)
//     calculatePosition()

//     if (style=="line") drawPath()
//     else if (style=="block") drawLines()
//   }

//   function updateCursorSize(newSize,newSizeY) {
//     sizeX = newSize
//     if (newSizeY) sizeY = newSizeY
//   }

//   return {
//     updateParticles: updateParticles,
//     move: move,
//     updateSize: updateSize,
//     updateCursorSize: updateCursorSize
//   }
// }

// // cursor create/remove/move event handler
// // by qwreey
// // (very dirty but may working)
// async function createCursorHandler(handlerFunctions) {
//   // Get Editor with dirty way (... due to vscode plugin api's limit)
//   /** @type { Element } */
//   let editor
//   while (!editor) {
//     await new Promise(resolve=>setTimeout(resolve, 100))
//     editor = document.querySelector(".part.editor")
//   }
//   handlerFunctions?.onStarted(editor)

//   // cursor cache
//   let updateHandlers = []
//   let cursorId = 0
//   let lastObjects = {}
//   let lastCursor = 0

//   // cursor update handler
//   function createCursorUpdateHandler(target,cursorId,cursorHolder,minimap) {
//     let lastX,lastY // save last position
//     let update = (editorX,editorY)=>{
//       // If cursor was destroyed, remove update handler
//       if (!lastObjects[cursorId]) {
//         updateHandlers.splice(updateHandlers.indexOf(update),1)
//         return
//       }

//       // get cursor position
//       let {left:newX,top:newY} = target.getBoundingClientRect()
//       let revX = newX-editorX,revY = newY-editorY

//       // if have no changes, ignore
//       if (revX == lastX && revY == lastY && lastCursor == cursorId) return
//       lastX = revX;lastY = revY // update last position

//       // wrong position
//       if (revX<=0 || revY<=0) return

//       // if it is invisible, ignore
//       if (target.style.visibility == "hidden") return

//       // if moved over minimap, ignore
//       if (minimap && minimap.offsetWidth != 0 && minimap.getBoundingClientRect().left <= newX) return

//       // if cursor is not displayed on screen, ignore
//       if (cursorHolder.getBoundingClientRect().left > newX) return

//       // update corsor position
//       lastCursor = cursorId
//       handlerFunctions?.onCursorPositionUpdated(revX,revY)
//       handlerFunctions?.onCursorSizeUpdated(target.clientWidth,target.clientHeight)
//     }
//     updateHandlers.push(update)
//   }

//   // handle cursor create/destroy event (using polling, due to event handlers are LAGGY)
//   let lastVisibility = "hidden"
//   setInterval(async ()=>{
//     let now = [],count = 0
//     // created
//     for (const target of editor.getElementsByClassName("cursor")) {
//       if (target.style.visibility != "hidden") count++
//       if (target.hasAttribute("cursorId")) {
//         now.push(+target.getAttribute("cursorId"))
//         continue
//       }
//       let thisCursorId = cursorId++
//       now.push(thisCursorId)
//       lastObjects[thisCursorId] = target
//       target.setAttribute("cursorId",thisCursorId)
//       let cursorHolder = target.parentElement.parentElement.parentElement
//       let minimap = cursorHolder.parentElement.querySelector(".minimap")
//       createCursorUpdateHandler(target,thisCursorId,cursorHolder,minimap)
//       // console.log("DEBUG-CursorCreated",thisCursorId)
//     }
    
//     // update visible
//     let visibility = count<=1 ? "visible" : "hidden"
//     if (visibility != lastVisibility) {
//       handlerFunctions?.onCursorVisibilityChanged(visibility)
//       lastVisibility = visibility
//     }

//     // destroyed
//     for (const id in lastObjects) {
//       if (now.includes(+id)) continue
//       delete lastObjects[+id]
//       // console.log("DEBUG-CursorRemoved",+id)
//     }
//   },handlerFunctions?.cursorUpdatePollingRate || 500)

//   // read cursor position polling
//   function updateLoop() {
//     let {left:editorX,top:editorY} = editor.getBoundingClientRect()
//     for (handler of updateHandlers) handler(editorX,editorY)
//     handlerFunctions?.onLoop()
//     requestAnimationFrame(updateLoop)
//   }

//   // handle editor view size changed event
//   function updateEditorSize() {
//     handlerFunctions?.onEditorSizeUpdated(editor.clientWidth,editor.clientHeight)
//   }
//   new ResizeObserver(updateEditorSize).observe(editor)
//   updateEditorSize()

//   // startup
//   updateLoop()
//   handlerFunctions?.onReady()
// }

// // Main handler code
// let cursorCanvas,rainbowCursorHandle
// createCursorHandler({

//   // cursor create/destroy event handler polling rate
//   cursorUpdatePollingRate: CursorUpdatePollingRate,

//   // When editor instance stared
//   onStarted: (editor)=>{
//     // create new canvas for make animation
//     cursorCanvas = document.createElement("canvas")
//     cursorCanvas.style.pointerEvents = "none"
//     cursorCanvas.style.position = "absolute"
//     cursorCanvas.style.top = "0px"
//     cursorCanvas.style.left = "0px"
//     cursorCanvas.style.zIndex = "1000"
//     editor.appendChild(cursorCanvas)

//     // create rainbow cursor effect
//     // thanks to https://github.com/tholman/cursor-effects/blob/master/src/rainbowCursor.js
//     // we can create trail effect!
//     let color = Color
//     if (color == "default") {
//       color = getComputedStyle(
//         document.querySelector("body>.monaco-workbench"))
//         .getPropertyValue("--vscode-editorCursor-background")
//         .trim()
//     }

//     rainbowCursorHandle = createTrail({
//       length: TrailLength,
//       color: color,
//       size: 7,
//       style: CursorStyle,
//       canvas: cursorCanvas
//     })
//   },

//   onReady:()=>{},

//   // when cursor moved
//   onCursorPositionUpdated: (x,y)=>{
//     rainbowCursorHandle.move(x,y)
//   },

//   // when editor view size changed
//   onEditorSizeUpdated: (x,y)=>{
//     rainbowCursorHandle.updateSize(x,y)
//   },

//   // when cursor size changed (emoji, ...)
//   onCursorSizeUpdated: (x,y)=>{
//     rainbowCursorHandle.updateCursorSize(x,y)
//     // rainbowCursorHandle.updateCursorSize(parseInt(y/lineHeight))
//   },

//   // when using multi cursor... just hide all
//   onCursorVisibilityChanged: (visibility)=>{
//     cursorCanvas.style.visibility = visibility
//   },

//   // update animation
//   onLoop: ()=>{
//     rainbowCursorHandle.updateParticles()
//   },

// })