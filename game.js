/* ================================================
   HAND SHOOTER – game.js
   Gesture-Controlled Space Shooter
   
   Controls:
   - POINT (index finger up, others folded)  → aim crosshair
   - V    (index + middle extended, rest folded) → FIRE ✌️
   - FIST (all fingers folded)               → activate shield
   ================================================ */

'use strict';

// ── DOM ────────────────────────────────────────────────────────────
const bgCanvas       = document.getElementById('bgCanvas');
const bctx           = bgCanvas.getContext('2d');
const gameCanvas     = document.getElementById('gameCanvas');
const ctx            = gameCanvas.getContext('2d');
const landmarkCanvas = document.getElementById('landmarkCanvas');
const lctx           = landmarkCanvas.getContext('2d');
const video          = document.getElementById('webcam');

const startScreen    = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startBtn       = document.getElementById('startBtn');
const restartBtn     = document.getElementById('restartBtn');
const scoreVal       = document.getElementById('scoreVal');
const livesRow       = document.getElementById('livesRow');
const finalScore     = document.getElementById('finalScore');
const bestScoreEl    = document.getElementById('bestScore');
const finalKills     = document.getElementById('finalKills');
const gestureIcon    = document.getElementById('gestureIcon');
const gestureText    = document.getElementById('gestureText');
const gesturePill    = document.getElementById('gesturePill');
const ammoFill       = document.getElementById('ammoFill');
const waveBanner     = document.getElementById('waveBanner');
const waveNumEl      = document.getElementById('waveNum');

// Screen flash element
const flash = document.createElement('div');
flash.id = 'screenFlash'; document.body.appendChild(flash);

// ── Config ─────────────────────────────────────────────────────────
const MAX_AMMO        = 20;
const AMMO_REGEN_TIME = 1800;   // ms per bullet regen
const FIRE_COOLDOWN   = 350;    // ms between shots
const MAX_LIVES       = 3;
const SHIELD_DURATION = 2500;   // ms shield lasts
const SHIELD_COOLDOWN = 5000;   // ms before shield reusable
const BULLET_SPEED    = 14;

// ── State ──────────────────────────────────────────────────────────
let state = {
  running:       false,
  score:         0,
  best:          parseInt(localStorage.getItem('handShooterBest') || '0', 10),
  kills:         0,
  lives:         MAX_LIVES,
  wave:          1,
  ammo:          MAX_AMMO,
  ammoTimer:     0,
  fireCooldown:  0,
  shieldActive:  false,
  shieldTimer:   0,
  shieldCooldown:0,
  gesture:       'NONE',
  gestureHistory:[],
  aimX:          0.5,
  aimY:          0.5,
  enemies:       [],
  bullets:       [],
  explosions:    [],
  stars:         [],
  enemyBullets:  [],
  lastTs:        0,
  waveTimer:     0,
  showingWave:   false,
  mpReady:       false,
};

// ── Resize ─────────────────────────────────────────────────────────
function resize() {
  bgCanvas.width = gameCanvas.width = landmarkCanvas.width = window.innerWidth;
  bgCanvas.height = gameCanvas.height = landmarkCanvas.height = window.innerHeight;
  generateStars();
  drawStarfield();
}
window.addEventListener('resize', resize);

// ── Starfield background ───────────────────────────────────────────
function generateStars() {
  state.stars = [];
  for (let i = 0; i < 260; i++) {
    state.stars.push({
      x: Math.random() * bgCanvas.width,
      y: Math.random() * bgCanvas.height,
      r: Math.random() * 1.8 + 0.2,
      a: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.4 + 0.05,
      hue: Math.random() > 0.9 ? '200' : '0',
    });
  }
}

function drawStarfield() {
  bctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  const bg = bctx.createRadialGradient(bgCanvas.width/2, bgCanvas.height/2, 0, bgCanvas.width/2, bgCanvas.height/2, bgCanvas.width*0.8);
  bg.addColorStop(0, '#06082a');
  bg.addColorStop(1, '#020510');
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  for (const s of state.stars) {
    bctx.beginPath();
    bctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    bctx.fillStyle = `hsla(${s.hue}, 80%, 95%, ${s.a})`;
    bctx.fill();
  }
}

// ── Gesture Detection ──────────────────────────────────────────────
// Gestures:
//   POINT  – index extended, middle+ring+pinky folded, thumb in
//   GUN    – index extended + thumb extended out, others folded
//   FIST   – all folded
//   OPEN   – 3+ fingers extended
//   NONE   – anything else

function isExtended(lm, tipIdx, pipIdx) {
  return lm[tipIdx].y < lm[pipIdx].y - 0.015;
}

function detectGesture(lm) {
  if (!lm || lm.length < 21) return { gesture: 'NONE', point: null };

  const idxExt  = isExtended(lm, 8,  6);
  const midExt  = isExtended(lm, 12, 10);
  const ringExt = isExtended(lm, 16, 14);
  const pinkExt = isExtended(lm, 20, 18);
  // Thumb: compare tip x vs base (mirrored feed)
  const thumbExt = lm[4].x < lm[3].x - 0.03;

  const totalExt = [idxExt, midExt, ringExt, pinkExt].filter(Boolean).length;

  let gesture = 'NONE';
  if (!idxExt && !midExt && !ringExt && !pinkExt && !thumbExt) gesture = 'FIST';
  else if (idxExt && midExt && !ringExt && !pinkExt) gesture = 'V';   // ✌️ peace/V = FIRE
  else if (idxExt && !midExt && !ringExt && !pinkExt) gesture = 'POINT';
  else if (totalExt >= 3) gesture = 'OPEN';

  // Pointing direction: tip of index finger (landmark 8) — mirrored
  const point = {
    x: 1 - lm[8].x,   // mirror X because we draw camera mirrored
    y: lm[8].y,
  };

  return { gesture, point };
}

function smooth(raw) {
  state.gestureHistory.push(raw);
  if (state.gestureHistory.length > 7) state.gestureHistory.shift();
  const counts = {};
  for (const g of state.gestureHistory) counts[g] = (counts[g]||0)+1;
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}

// ── Enemy ──────────────────────────────────────────────────────────
const ENEMY_TYPES = [
  { shape:'saucer', w:54, h:28, hp:1, speed:1.2, pts:10, color:'#ff2d78', fireRate:0 },
  { shape:'drone',  w:36, h:36, hp:2, speed:0.9, pts:20, color:'#a855f7', fireRate:0.0012 },
  { shape:'boss',   w:90, h:60, hp:8, speed:0.5, pts:100, color:'#ff8c00', fireRate:0.003 },
];

class Enemy {
  constructor(type, x, y) {
    const t = ENEMY_TYPES[type];
    Object.assign(this, structuredClone(t));
    this.maxHp = this.hp;
    this.x = x; this.y = y;
    this.type = type;
    this.vx = (Math.random()-0.5) * this.speed;
    this.vy = this.speed * (0.4 + Math.random()*0.6);
    this.angle = 0;
    this.pulse = Math.random()*Math.PI*2;
    this.hitFlash = 0;
    this.id = Math.random();
  }

  update(dt) {
    this.x += this.vx;
    this.y += this.vy * (state.wave > 3 ? 1.3 : 1);
    this.angle += 0.02;
    this.pulse += dt * 0.003;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 0.01);
    // bounce horizontally
    if (this.x < this.w/2 || this.x > gameCanvas.width - this.w/2) this.vx *= -1;
    // enemy firing
    if (this.fireRate > 0 && Math.random() < this.fireRate * dt) {
      state.enemyBullets.push(new EnemyBullet(this.x, this.y + this.h/2));
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    const glow = this.hitFlash > 0 ? '#ffffff' : this.color;
    ctx.shadowColor = glow;
    ctx.shadowBlur  = 18 + Math.sin(this.pulse)*8;
    ctx.strokeStyle = glow;
    ctx.lineWidth   = 2;

    if (this.shape === 'saucer') {
      // saucer body
      ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.color + 'cc';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w/2, this.h/2, 0, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
      // dome
      ctx.fillStyle = 'rgba(0,245,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, -this.h/2+2, this.w/4, this.h/3, 0, Math.PI, 0);
      ctx.fill();
    } else if (this.shape === 'drone') {
      ctx.rotate(this.angle * 0.5);
      // Diamond shape
      ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.color + 'cc';
      ctx.beginPath();
      ctx.moveTo(0, -this.h/2);
      ctx.lineTo(this.w/2, 0);
      ctx.lineTo(0, this.h/2);
      ctx.lineTo(-this.w/2, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      // Boss — large hexagon
      ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.color + 'dd';
      ctx.beginPath();
      for (let i=0;i<6;i++) {
        const a = (i/6)*Math.PI*2 + this.angle*0.1;
        const rx = Math.cos(a)*this.w/2;
        const ry = Math.sin(a)*this.h/2;
        i===0 ? ctx.moveTo(rx,ry) : ctx.lineTo(rx,ry);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // HP bar
    if (this.maxHp > 1) {
      const bw = this.w; const bh = 5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-bw/2, -this.h/2-10, bw, bh);
      ctx.fillStyle = this.color;
      ctx.fillRect(-bw/2, -this.h/2-10, bw*(this.hp/this.maxHp), bh);
    }
    ctx.restore();
  }

  isDead() { return this.hp <= 0; }
  isOffscreen() { return this.y > gameCanvas.height + 80; }
}

// ── Bullets ────────────────────────────────────────────────────────
class Bullet {
  constructor(x, y, vx, vy) {
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.life=1; this.trail=[];
  }
  update() {
    this.trail.push({x:this.x, y:this.y});
    if (this.trail.length > 8) this.trail.shift();
    this.x+=this.vx; this.y+=this.vy;
  }
  draw() {
    // trail
    for (let i=0;i<this.trail.length;i++) {
      const alpha = (i/this.trail.length)*0.5;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, 3*(i/this.trail.length), 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,45,120,${alpha})`;
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor='#ff2d78'; ctx.shadowBlur=16;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5, 0, Math.PI*2);
    ctx.fillStyle='#ff2d78'; ctx.fill();
    // core
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  isOffscreen() { return this.x<0||this.x>gameCanvas.width||this.y<0||this.y>gameCanvas.height; }
}

class EnemyBullet {
  constructor(x, y) {
    this.x=x; this.y=y; this.speed=4+(state.wave*0.3);
  }
  update() { this.y+=this.speed; }
  draw() {
    ctx.save();
    ctx.shadowColor='#ff8c00'; ctx.shadowBlur=12;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 6, 0, Math.PI*2);
    ctx.fillStyle='rgba(255,140,0,0.85)'; ctx.fill();
    ctx.restore();
  }
  isOffscreen() { return this.y > gameCanvas.height + 20; }
  hitsPlayer(ax, ay, r) { return Math.hypot(this.x-ax, this.y-ay) < r+6; }
}

// ── Explosions ─────────────────────────────────────────────────────
class Explosion {
  constructor(x, y, color, big=false) {
    this.x=x; this.y=y; this.life=1; this.big=big;
    this.sparks=[];
    const n = big ? 40 : 20;
    for (let i=0;i<n;i++) {
      const angle=Math.random()*Math.PI*2;
      const spd=(big?3:1.5)+Math.random()*(big?9:5);
      this.sparks.push({ x:0, y:0, vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd, r:Math.random()*(big?5:3)+1.5, color });
    }
  }
  update() {
    this.life -= big ? 0.018 : 0.03;
    this.life -= 0.025;
    for (const s of this.sparks) { s.x+=s.vx; s.y+=s.vy; s.vy+=0.2; s.vx*=0.96; }
  }
  draw() {
    for (const s of this.sparks) {
      ctx.save();
      ctx.globalAlpha=Math.max(0,this.life);
      ctx.shadowColor=s.color; ctx.shadowBlur=10;
      ctx.beginPath();
      ctx.arc(this.x+s.x, this.y+s.y, s.r*this.life, 0, Math.PI*2);
      ctx.fillStyle=s.color; ctx.fill();
      ctx.restore();
    }
  }
  isDead() { return this.life<=0; }
}

// ── Crosshair / Player Ship ────────────────────────────────────────
function drawCrosshair(x, y, gesture, shieldOn) {
  const cs = 28;
  ctx.save();
  ctx.translate(x, y);

  // Shield bubble
  if (shieldOn) {
    const sp = (Date.now()*0.003) % (Math.PI*2);
    ctx.beginPath();
    ctx.arc(0, 0, 58 + Math.sin(sp)*4, 0, Math.PI*2);
    ctx.strokeStyle='rgba(57,255,20,0.6)';
    ctx.lineWidth=3;
    ctx.shadowColor='#39ff14'; ctx.shadowBlur=20;
    ctx.stroke();
    ctx.fillStyle='rgba(57,255,20,0.06)';
    ctx.fill();
  }

  // Outer ring with rotation
  ctx.rotate((Date.now()*0.001));
  ctx.beginPath();
  ctx.arc(0, 0, cs+4, 0, Math.PI*2);
  ctx.strokeStyle = gesture==='V' ? '#ff2d78' : gesture==='FIST' ? '#39ff14' : '#00f5ff';
  ctx.lineWidth=1.5;
  ctx.setLineDash([6,5]);
  ctx.shadowColor=ctx.strokeStyle; ctx.shadowBlur=8;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.rotate(-(Date.now()*0.001));

  // Inner crosshair lines
  ctx.strokeStyle = gesture==='V' ? '#ff2d78' : '#00f5ff';
  ctx.shadowColor=ctx.strokeStyle; ctx.shadowBlur=12;
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(-cs,0); ctx.lineTo(-8,0);
  ctx.moveTo(8,0);   ctx.lineTo(cs,0);
  ctx.moveTo(0,-cs); ctx.lineTo(0,-8);
  ctx.moveTo(0,8);   ctx.lineTo(0,cs);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(0,0,4,0,Math.PI*2);
  ctx.fillStyle= gesture==='V' ? '#ff2d78' : '#fff';
  ctx.shadowBlur=10; ctx.fill();

  // Ship body below crosshair
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(0,245,255,0.15)';
  ctx.strokeStyle='#00f5ff';
  ctx.lineWidth=1.5;
  ctx.shadowColor='#00f5ff'; ctx.shadowBlur=16;
  ctx.beginPath();
  ctx.moveTo(0,-18);
  ctx.lineTo(14,8);
  ctx.lineTo(0,2);
  ctx.lineTo(-14,8);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  ctx.restore();
}

// ── Wave Spawning ──────────────────────────────────────────────────
function spawnWave(wave) {
  const enemies = [];
  const cols = Math.min(3+wave, 8);
  const rows = Math.min(1+Math.floor(wave/2), 4);
  const W = gameCanvas.width;
  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      const typeIdx = wave>=4 && r===0 ? 1 : 0;
      const ex = 80 + (c/(cols-1 || 1)) * (W-160);
      const ey = -80 - r*80;
      enemies.push(new Enemy(typeIdx, ex, ey));
    }
  }
  // Boss wave every 5
  if (wave % 5 === 0) {
    enemies.push(new Enemy(2, W/2, -120));
  }
  return enemies;
}

// ── Update Lives HUD ───────────────────────────────────────────────
function updateLivesHUD() {
  livesRow.innerHTML = '';
  for (let i=0;i<MAX_LIVES;i++) {
    const s = document.createElement('span');
    s.textContent = i < state.lives ? '❤️' : '🖤';
    livesRow.appendChild(s);
  }
}

// ── Hit detection: circle vs rect ─────────────────────────────────
function circleHitsEnemy(bx, by, e) {
  const dx = Math.abs(bx - e.x);
  const dy = Math.abs(by - e.y);
  return dx < e.w/2+6 && dy < e.h/2+6;
}

// ── Game Loop ──────────────────────────────────────────────────────
function gameLoop(ts) {
  if (!state.running) return;
  const dt = Math.min(ts - state.lastTs, 60);
  state.lastTs = ts;

  // --- clear ---
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

  // Draw mirrored camera feed
  ctx.save();
  ctx.scale(-1,1); ctx.translate(-gameCanvas.width,0);
  if (video.readyState >= video.HAVE_ENOUGH_DATA) {
    ctx.globalAlpha = 0.22;
    ctx.drawImage(video, 0,0, gameCanvas.width, gameCanvas.height);
  }
  ctx.restore();

  // Overlay
  ctx.fillStyle='rgba(2,5,16,0.48)';
  ctx.fillRect(0,0,gameCanvas.width,gameCanvas.height);

  // Scroll stars on bg for parallax
  for (const s of state.stars) {
    s.y += s.speed;
    if (s.y > bgCanvas.height) { s.y=0; s.x=Math.random()*bgCanvas.width; }
  }
  drawStarfield();

  // Shield cooldown
  if (state.shieldActive) {
    state.shieldTimer -= dt;
    if (state.shieldTimer <= 0) { state.shieldActive=false; state.shieldCooldown=SHIELD_COOLDOWN; }
  }
  if (state.shieldCooldown > 0) state.shieldCooldown -= dt;

  // Ammo regen
  if (state.ammo < MAX_AMMO) {
    state.ammoTimer -= dt;
    if (state.ammoTimer <= 0) { state.ammo++; state.ammoTimer=AMMO_REGEN_TIME; }
  }
  ammoFill.style.width = (state.ammo/MAX_AMMO*100)+'%';

  // Fire cooldown
  if (state.fireCooldown > 0) state.fireCooldown -= dt;

  // Aim
  const ax = state.aimX * gameCanvas.width;
  const ay = state.aimY * gameCanvas.height;

  // ---- FIRE (auto-fire while V gesture held and has ammo) ----
  if (state.gesture==='V' && state.fireCooldown<=0 && state.ammo>0) {
    state.ammo--;
    state.fireCooldown = FIRE_COOLDOWN;
    state.bullets.push(new Bullet(ax, ay, 0, -BULLET_SPEED));
    // Screen flash
    flash.style.background='rgba(255,45,120,0.12)';
    flash.style.opacity='1'; setTimeout(()=>flash.style.opacity='0', 80);
  }

  // ---- SHIELD ----
  if (state.gesture==='FIST' && !state.shieldActive && state.shieldCooldown<=0) {
    state.shieldActive = true;
    state.shieldTimer  = SHIELD_DURATION;
  }

  // ---- Wave management ----
  if (state.enemies.length===0 && !state.showingWave) {
    state.wave++;
    state.showingWave=true;
    waveNumEl.textContent = state.wave;
    waveBanner.classList.remove('hidden');
    setTimeout(()=>{
      waveBanner.classList.add('hidden');
      state.enemies = spawnWave(state.wave);
      state.showingWave=false;
    }, 1800);
  }

  // ---- Enemy bullets ----
  for (let i=state.enemyBullets.length-1; i>=0; i--) {
    const eb = state.enemyBullets[i];
    eb.update(); eb.draw();
    if (eb.isOffscreen()) { state.enemyBullets.splice(i,1); continue; }
    if (!state.shieldActive && eb.hitsPlayer(ax, ay, 30)) {
      state.lives--;
      state.enemyBullets.splice(i,1);
      updateLivesHUD();
      flash.style.background='rgba(255,0,0,0.2)';
      flash.style.opacity='1'; setTimeout(()=>flash.style.opacity='0', 200);
      state.explosions.push(new Explosion(ax, ay, '#ff2d78'));
      if (state.lives<=0) { endGame(); return; }
    }
  }

  // ---- Player bullets ----
  for (let i=state.bullets.length-1; i>=0; i--) {
    const b = state.bullets[i];
    b.update(); b.draw();
    if (b.isOffscreen()) { state.bullets.splice(i,1); continue; }
    let hit=false;
    for (let j=state.enemies.length-1; j>=0; j--) {
      const e=state.enemies[j];
      if (circleHitsEnemy(b.x, b.y, e)) {
        e.hp--; e.hitFlash=1;
        state.bullets.splice(i,1); hit=true;
        if (e.isDead()) {
          state.score += e.pts * state.wave;
          state.kills++;
          scoreVal.textContent = state.score;
          const big = e.shape==='boss';
          state.explosions.push(new Explosion(e.x, e.y, e.color, big));
          if (big) {
            flash.style.background='rgba(255,140,0,0.2)';
            flash.style.opacity='1'; setTimeout(()=>flash.style.opacity='0',250);
          }
          state.enemies.splice(j,1);
        }
        break;
      }
    }
    if (hit) continue;
  }

  // ---- Enemies ----
  for (let i=state.enemies.length-1; i>=0; i--) {
    const e=state.enemies[i];
    e.update(dt); e.draw();
    if (e.isOffscreen()) {
      if (!state.shieldActive) {
        state.lives--;
        updateLivesHUD();
        flash.style.background='rgba(255,0,0,0.25)';
        flash.style.opacity='1'; setTimeout(()=>flash.style.opacity='0',250);
      }
      state.enemies.splice(i,1);
      if (state.lives<=0) { endGame(); return; }
      continue;
    }
    // Collision with player
    if (!state.shieldActive && circleHitsEnemy(ax, ay, e)) {
      e.hp=0;
      state.lives--;
      state.explosions.push(new Explosion(e.x,e.y,e.color));
      state.enemies.splice(i,1);
      updateLivesHUD();
      flash.style.background='rgba(255,0,0,0.25)';
      flash.style.opacity='1'; setTimeout(()=>flash.style.opacity='0',250);
      if (state.lives<=0) { endGame(); return; }
    }
  }

  // ---- Explosions ----
  for (let i=state.explosions.length-1; i>=0; i--) {
    state.explosions[i].update(); state.explosions[i].draw();
    if (state.explosions[i].isDead()) state.explosions.splice(i,1);
  }

  // ---- Crosshair ----
  drawCrosshair(ax, ay, state.gesture, state.shieldActive);

  // ---- Shield cooldown indicator ----
  if (!state.shieldActive && state.shieldCooldown > 0) {
    const frac = 1-(state.shieldCooldown/SHIELD_COOLDOWN);
    ctx.save();
    ctx.font='bold 11px Orbitron,monospace'; ctx.textAlign='center';
    ctx.fillStyle='rgba(57,255,20,0.5)';
    ctx.fillText(`SHIELD ${Math.ceil(state.shieldCooldown/1000)}s`, ax, ay+70);
    ctx.restore();
  }

  requestAnimationFrame(gameLoop);
}

// ── MediaPipe ──────────────────────────────────────────────────────
function initMediaPipe() {
  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  hands.setOptions({ maxNumHands:1, modelComplexity:1, minDetectionConfidence:0.72, minTrackingConfidence:0.65 });
  hands.onResults(results => {
    lctx.clearRect(0,0,landmarkCanvas.width,landmarkCanvas.height);
    let rawGesture='NONE', point=null;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length>0) {
      const lm = results.multiHandLandmarks[0];
      const det = detectGesture(lm);
      rawGesture = det.gesture;
      point = det.point;

      // Draw skeleton mirrored
      lctx.save();
      lctx.scale(-1,1); lctx.translate(-landmarkCanvas.width,0);
      drawConnectors(lctx, lm, HAND_CONNECTIONS, { color:'rgba(0,245,255,0.5)', lineWidth:1.5 });
      drawLandmarks(lctx, lm, { color:'#00f5ff', fillColor:'rgba(0,245,255,0.3)', radius:3, lineWidth:1 });
      lctx.restore();
    }

    // Update aim — smooth with lerp
    if (point) {
      const lerpF = 0.25;
      state.aimX += (point.x - state.aimX)*lerpF;
      state.aimY += (point.y - state.aimY)*lerpF;
      // Clamp
      state.aimX = Math.max(0.04, Math.min(0.96, state.aimX));
      state.aimY = Math.max(0.06, Math.min(0.94, state.aimY));
    }

    const smoothed = smooth(rawGesture);
    state.gesture = smoothed;
    updateGestureHUD(smoothed);
  });

  const cam = new Camera(video, {
    onFrame: async () => { await hands.send({ image:video }); },
    width:640, height:480,
  });
  cam.start().catch(err => alert('Camera access required.\n'+err));
}

function updateGestureHUD(g) {
  const map = {
    V:     { icon:'✌️', text:'FIRE!',   cls:'fire' },
    POINT: { icon:'☝️',  text:'AIMING',  cls:'' },
    FIST:  { icon:'✊',  text:'SHIELD',  cls:'shield' },
    OPEN:  { icon:'🖐️',  text:'OPEN',    cls:'' },
    NONE:  { icon:'✋',  text:'WAITING', cls:'' },
  };
  const d = map[g]||map.NONE;
  gestureIcon.textContent=d.icon;
  gestureText.textContent=d.text;
  gesturePill.className='gesture-pill '+d.cls;
}

// ── End Game ───────────────────────────────────────────────────────
function endGame() {
  state.running=false;
  if (state.score>state.best) { state.best=state.score; localStorage.setItem('handShooterBest',state.best); }
  finalScore.textContent = state.score;
  bestScoreEl.textContent= state.best;
  finalKills.textContent = state.kills;
  gameOverScreen.classList.remove('hidden');
}

// ── Start Game ─────────────────────────────────────────────────────
function startGame() {
  Object.assign(state, {
    running:true, score:0, kills:0, lives:MAX_LIVES, wave:0,
    ammo:MAX_AMMO, ammoTimer:AMMO_REGEN_TIME, fireCooldown:0,
    shieldActive:false, shieldTimer:0, shieldCooldown:0,
    enemies:[], bullets:[], explosions:[], enemyBullets:[],
    gestureHistory:[], aimX:0.5, aimY:0.7,
    showingWave:false, lastTs:performance.now(),
  });
  scoreVal.textContent='0';
  updateLivesHUD();
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');

  // Force first wave
  state.wave=1;
  state.enemies=spawnWave(1);
  waveNumEl.textContent=1;
  waveBanner.classList.remove('hidden');
  setTimeout(()=>waveBanner.classList.add('hidden'),1600);

  requestAnimationFrame(gameLoop);
}

// ── Boot ───────────────────────────────────────────────────────────
resize();

startBtn.addEventListener('click', () => {
  initMediaPipe();
  startGame();
});
restartBtn.addEventListener('click', startGame);

// Idle bg animation
(function idleBg() {
  if (state.running) return;
  for (const s of state.stars) { s.y+=s.speed; if(s.y>bgCanvas.height){s.y=0;s.x=Math.random()*bgCanvas.width;} }
  drawStarfield();
  requestAnimationFrame(idleBg);
})();
