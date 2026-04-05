// Pixel-art styled crab mascot with 7 emotion states
// Designed with setSpriteSheet() for easy upgrade to real sprites

const EMOTIONS = {
  idle:      { color: '#00DDFF', eyeAnim: 'blink',   mouthAnim: 'neutral',  particles: 'float' },
  listening: { color: '#00FF66', eyeAnim: 'wide',     mouthAnim: 'open',     particles: 'pulse' },
  thinking:  { color: '#FFCC00', eyeAnim: 'squint',   mouthAnim: 'hmm',      particles: 'spin' },
  working:   { color: '#AA66FF', eyeAnim: 'focused',  mouthAnim: 'neutral',  particles: 'spark' },
  happy:     { color: '#00FF66', eyeAnim: 'happy',    mouthAnim: 'smile',    particles: 'burst' },
  error:     { color: '#FF4466', eyeAnim: 'x',        mouthAnim: 'frown',    particles: 'shake' },
  sleeping:  { color: '#334466', eyeAnim: 'closed',   mouthAnim: 'neutral',  particles: 'zzz' },
};

let canvas, ctx;
let emotion = 'idle';
let tick = 0;
let spriteSheet = null; // for future drop-in upgrade
let particles = [];

// Pixel scale factor - draws chunky pixels
const PX = 4;

export function init(canvasId) {
  canvas = document.getElementById(canvasId);
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const headerH = canvas.parentElement.querySelector('.zone-header')?.offsetHeight || 24;
  const labelH = document.getElementById('mascot-label')?.offsetHeight || 30;
  canvas.width = rect.width;
  canvas.height = rect.height - headerH - labelH;
}

export function setEmotion(newEmotion) {
  if (EMOTIONS[newEmotion] && newEmotion !== emotion) {
    emotion = newEmotion;
    particles = [];

    // Update label and glow
    const label = document.getElementById('mascot-label');
    const zone = document.getElementById('zone-mascot');
    if (label) {
      label.textContent = emotion.toUpperCase();
      label.style.color = EMOTIONS[emotion].color;
      label.style.textShadow = `0 0 8px ${EMOTIONS[emotion].color}`;
    }
    if (zone) {
      zone.setAttribute('data-emotion', emotion);
    }
  }
}

export function setSpriteSheet(sheet) {
  spriteSheet = sheet;
}

export function update(dt) {
  tick += dt;
  updateParticles(dt);
}

export function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (spriteSheet) {
    // Future: draw sprite sheet frame based on emotion
    return;
  }

  drawProceduralCrab();
  drawParticles();
}

// --- Procedural Pixel Crab ---

function drawProceduralCrab() {
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const em = EMOTIONS[emotion];
  const t = tick / 1000;

  // Body bob
  const bob = Math.sin(t * 2) * PX;

  // Shell (main body) - rounded crab shape
  const shellColor = em.color;
  const shellDark = darken(shellColor, 0.4);
  const shellMid = darken(shellColor, 0.2);

  // Body pixels (12x8 grid, centered)
  const bodyW = 12;
  const bodyH = 8;
  const bx = cx - (bodyW * PX) / 2;
  const by = cy - (bodyH * PX) / 2 + bob;

  // Shell shape - pixel pattern
  const shell = [
    '  XXXXXXXX  ',
    ' XXXXXXXXXX ',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    ' XXXXXXXXXX ',
    '  XXXXXXXX  ',
  ];

  // Draw shell shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  drawPixelPattern(shell, bx + PX, by + PX * 2, PX);

  // Draw shell body
  ctx.fillStyle = shellDark;
  drawPixelPattern(shell, bx, by, PX);

  // Shell highlight (top rows brighter)
  ctx.fillStyle = shellMid;
  drawPixelPattern(shell.slice(0, 3), bx, by, PX);
  ctx.fillStyle = shellColor;
  drawPixelPattern(shell.slice(0, 1), bx, by, PX);

  // Eyes
  drawEyes(cx, by + PX * 2, em.eyeAnim, t, shellColor);

  // Mouth
  drawMouth(cx, by + PX * 5, em.mouthAnim, t);

  // Claws
  const clawBob = Math.sin(t * 3) * PX * 0.5;
  drawClaw(bx - PX * 4, by + PX * 2 + clawBob, false, shellColor, shellDark);
  drawClaw(bx + bodyW * PX + PX, by + PX * 2 - clawBob, true, shellColor, shellDark);

  // Legs (3 per side)
  ctx.fillStyle = shellDark;
  for (let i = 0; i < 3; i++) {
    const legY = by + PX * (3 + i * 1.5);
    const legWiggle = Math.sin(t * 4 + i) * PX;
    // Left legs
    pixel(bx - PX, legY + legWiggle, PX);
    pixel(bx - PX * 2, legY + PX + legWiggle, PX);
    // Right legs
    pixel(bx + bodyW * PX, legY - legWiggle, PX);
    pixel(bx + bodyW * PX + PX, legY + PX - legWiggle, PX);
  }
}

function drawEyes(cx, baseY, anim, t, color) {
  const eyeSpacing = PX * 3;
  const lx = cx - eyeSpacing;
  const rx = cx + eyeSpacing - PX;

  switch (anim) {
    case 'blink': {
      const blinkPhase = t % 4;
      if (blinkPhase < 0.1) {
        // Blinking - horizontal line
        ctx.fillStyle = '#FFFFFF';
        pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
        pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      } else {
        drawNormalEyes(lx, rx, baseY);
      }
      break;
    }
    case 'wide':
      ctx.fillStyle = '#FFFFFF';
      pixel(lx, baseY - PX, PX); pixel(lx + PX, baseY - PX, PX);
      pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
      pixel(rx, baseY - PX, PX); pixel(rx + PX, baseY - PX, PX);
      pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      // Pupils
      ctx.fillStyle = '#111';
      pixel(lx + PX, baseY, PX);
      pixel(rx, baseY, PX);
      break;
    case 'squint':
      ctx.fillStyle = '#FFFFFF';
      pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
      pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      break;
    case 'focused': {
      drawNormalEyes(lx, rx, baseY);
      // Focus dots rotating
      const fx = Math.cos(t * 5) * PX;
      const fy = Math.sin(t * 5) * PX;
      ctx.fillStyle = color;
      pixel(lx + PX + fx, baseY + fy, PX * 0.5);
      pixel(rx + fx, baseY + fy, PX * 0.5);
      break;
    }
    case 'happy':
      // Upside down U shapes
      ctx.fillStyle = '#FFFFFF';
      pixel(lx, baseY - PX, PX); pixel(lx + PX, baseY - PX, PX);
      pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
      ctx.fillStyle = '#111';
      pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
      ctx.fillStyle = '#FFFFFF';
      pixel(rx, baseY - PX, PX); pixel(rx + PX, baseY - PX, PX);
      pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      ctx.fillStyle = '#111';
      pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      break;
    case 'x':
      // X eyes for error
      ctx.fillStyle = '#FF4466';
      pixel(lx, baseY - PX, PX); pixel(lx + PX, baseY, PX);
      pixel(lx + PX, baseY - PX, PX); pixel(lx, baseY, PX);
      pixel(rx, baseY - PX, PX); pixel(rx + PX, baseY, PX);
      pixel(rx + PX, baseY - PX, PX); pixel(rx, baseY, PX);
      break;
    case 'closed':
      ctx.fillStyle = '#FFFFFF';
      pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
      pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
      break;
    default:
      drawNormalEyes(lx, rx, baseY);
  }
}

function drawNormalEyes(lx, rx, baseY) {
  ctx.fillStyle = '#FFFFFF';
  pixel(lx, baseY - PX, PX); pixel(lx + PX, baseY - PX, PX);
  pixel(lx, baseY, PX); pixel(lx + PX, baseY, PX);
  pixel(rx, baseY - PX, PX); pixel(rx + PX, baseY - PX, PX);
  pixel(rx, baseY, PX); pixel(rx + PX, baseY, PX);
  // Pupils
  ctx.fillStyle = '#111';
  pixel(lx + PX, baseY, PX);
  pixel(rx, baseY, PX);
}

function drawMouth(cx, baseY, anim, t) {
  const mx = cx - PX * 2;

  switch (anim) {
    case 'neutral':
      ctx.fillStyle = '#2A1520';
      pixel(mx, baseY, PX);
      pixel(mx + PX, baseY, PX);
      pixel(mx + PX * 2, baseY, PX);
      pixel(mx + PX * 3, baseY, PX);
      break;
    case 'open': {
      const openSize = Math.sin(t * 6) * 0.5 + 0.5;
      ctx.fillStyle = '#2A1520';
      pixel(mx + PX, baseY, PX);
      pixel(mx + PX * 2, baseY, PX);
      if (openSize > 0.3) {
        pixel(mx + PX, baseY + PX, PX);
        pixel(mx + PX * 2, baseY + PX, PX);
      }
      break;
    }
    case 'hmm':
      ctx.fillStyle = '#2A1520';
      pixel(mx + PX, baseY, PX);
      pixel(mx + PX * 2, baseY, PX);
      // Wavy
      pixel(mx + PX * 3, baseY - (Math.sin(t * 4) > 0 ? PX : 0), PX);
      break;
    case 'smile':
      ctx.fillStyle = '#2A1520';
      pixel(mx, baseY - PX, PX);
      pixel(mx + PX, baseY, PX);
      pixel(mx + PX * 2, baseY, PX);
      pixel(mx + PX * 3, baseY - PX, PX);
      break;
    case 'frown':
      ctx.fillStyle = '#2A1520';
      pixel(mx, baseY + PX, PX);
      pixel(mx + PX, baseY, PX);
      pixel(mx + PX * 2, baseY, PX);
      pixel(mx + PX * 3, baseY + PX, PX);
      break;
  }
}

function drawClaw(x, y, mirrored, color, dark) {
  const d = mirrored ? -1 : 1;
  ctx.fillStyle = dark;
  // Arm
  pixel(x, y + PX, PX);
  pixel(x, y + PX * 2, PX);
  // Pincer top
  ctx.fillStyle = color;
  pixel(x - d * PX, y, PX);
  pixel(x, y, PX);
  pixel(x + d * PX, y, PX);
  // Pincer bottom
  pixel(x - d * PX, y + PX * 2, PX);
  pixel(x + d * PX, y + PX * 2, PX);
  // Pincer opening
  ctx.fillStyle = '#0D1220';
  pixel(x, y + PX, PX);
}

// --- Particles ---

function updateParticles(dt) {
  const em = EMOTIONS[emotion];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Spawn
  if (particles.length < 15 && Math.random() < 0.1) {
    particles.push(createParticle(cx, cy, em.particles, em.color));
  }

  // Update
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt / 1000;
    p.y += p.vy * dt / 1000;
    p.alpha = Math.max(0, p.life / p.maxLife);

    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function createParticle(cx, cy, type, color) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 30 + Math.random() * 40;
  const base = {
    x: cx + Math.cos(angle) * dist,
    y: cy + Math.sin(angle) * dist,
    vx: 0, vy: 0,
    life: 2000 + Math.random() * 1000,
    maxLife: 3000,
    size: PX * (0.5 + Math.random() * 0.5),
    color,
    alpha: 1,
    char: null,
  };

  switch (type) {
    case 'float':
      base.vy = -10 - Math.random() * 10;
      break;
    case 'pulse':
      base.vx = Math.cos(angle) * 20;
      base.vy = Math.sin(angle) * 20;
      break;
    case 'spin':
      base.vx = Math.cos(angle) * 15;
      base.vy = Math.sin(angle) * 15;
      base.char = ['?', '*', '.'][Math.floor(Math.random() * 3)];
      break;
    case 'spark':
      base.vx = (Math.random() - 0.5) * 40;
      base.vy = -20 - Math.random() * 30;
      base.life = 800 + Math.random() * 400;
      base.maxLife = 1200;
      break;
    case 'burst':
      base.vx = Math.cos(angle) * 30;
      base.vy = Math.sin(angle) * 30;
      base.life = 600 + Math.random() * 400;
      base.maxLife = 1000;
      break;
    case 'shake':
      base.vx = (Math.random() - 0.5) * 60;
      base.vy = (Math.random() - 0.5) * 60;
      base.life = 500;
      base.maxLife = 500;
      break;
    case 'zzz':
      base.vy = -8;
      base.vx = 5;
      base.char = 'z';
      base.life = 3000;
      base.maxLife = 3000;
      break;
  }
  return base;
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.alpha;
    if (p.char) {
      ctx.fillStyle = p.color;
      ctx.font = `${p.size * 4}px VT323`;
      ctx.fillText(p.char, p.x, p.y);
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Helpers ---

function pixel(x, y, size) {
  ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
}

function drawPixelPattern(pattern, startX, startY, size) {
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      if (pattern[r][c] === 'X') {
        pixel(startX + c * size, startY + r * size, size);
      }
    }
  }
}

function darken(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.floor(r * (1 - amount))},${Math.floor(g * (1 - amount))},${Math.floor(b * (1 - amount))})`;
}
