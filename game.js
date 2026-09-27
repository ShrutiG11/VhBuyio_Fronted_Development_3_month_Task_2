'use strict';

/* ==========================================================
   ChronoVault: a simple time-rewind puzzle game
   ----------------------------------------------------------
   RECORD  Every move (or wait) the player makes is saved.
   REWIND  Time jumps back to the start of the level.
   ECHO    A ghost replays the recording step by step while
           the player moves again.
   Switches open doors of the same letter while anyone
   (player or ghost) stands on them. Levels live in levels.js.
   ========================================================== */

// ---------- Settings ----------
const TILE = 48;          // size of one grid tile in canvas pixels
const MOVE_MS = 120;      // how long one step takes to animate
const REPEAT_MS = 110;    // throttle for keys that are held down
const SAVE_KEY = 'chronovault-progress';

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  wait: { x: 0, y: 0 },
};

const KEY_ACTIONS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'wait', Period: 'wait',
};

const COLORS = {
  void: '#070b18',
  floor: '#101830',
  floorAlt: '#121b36',
  wall: '#27335f',
  wallRim: '#3d4e8e',
  wallFace: '#19213f',
  player: '#38e1ff',
  ghost: '#b98cff',
  exit: '#9dff6e',
};

// A switch and the doors it opens share a color.
const KEY_COLORS = { a: '#ffcc3d', b: '#ff5d9e', c: '#5b8cff', d: '#ff8a3d' };

const MODE_INFO = {
  record: { badge: 'REC', cls: 'rec', status: 'Recording. Every move and wait is saved. Press R to rewind.' },
  rewind: { badge: '◀◀ REWIND', cls: 'rewind', status: 'Rewinding time…' },
  echo: { badge: '👻 ECHO', cls: 'echo', status: 'Your ghost is replaying your recording. R: try again · Backspace: record a new ghost.' },
  won: { badge: '🏁 ESCAPED', cls: 'won', status: 'Vault unlocked!' },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const gameWrap = $('game-wrap');
const stage = $('stage');
const ui = {
  levelNum: $('hud-level-num'),
  levelName: $('hud-level-name'),
  mode: $('hud-mode'),
  step: $('hud-step'),
  ghostLabel: $('hud-ghost-label'),
  ghostBar: $('hud-ghost-bar'),
  hint: $('hint'),
  status: $('status'),
  winOverlay: $('win-overlay'),
  winTitle: $('win-title'),
  winText: $('win-text'),
  winNext: $('win-next'),
  levelGrid: $('level-grid'),
  playBtn: $('btn-play'),
  menuProgress: $('menu-progress'),
};

// ---------- Saved progress (localStorage) ----------
const progress = loadProgress();

function loadProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return new Set(Array.isArray(data.completed) ? data.completed : []);
  } catch (err) {
    return new Set(); // storage blocked or corrupted: start fresh
  }
}

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ completed: [...progress] }));
  } catch (err) {
    // Storage unavailable (e.g. private mode): progress just won't persist.
  }
}

function isUnlocked(index) {
  return index === 0 || progress.has(LEVELS[index].id) || progress.has(LEVELS[index - 1].id);
}

// ---------- Level loading ----------
let level = null;

function parseLevel(def) {
  const rows = def.map.length;
  const cols = Math.max(...def.map.map((row) => row.length));
  const lvl = { def, cols, rows, tiles: [], switches: [], doors: [], start: null, exit: null };

  for (let y = 0; y < rows; y++) {
    lvl.tiles.push([]);
    for (let x = 0; x < cols; x++) {
      const ch = def.map[y][x] || ' ';
      let tile = 'floor';
      if (ch === '#') tile = 'wall';
      else if (ch === ' ') tile = 'void';
      else if (ch === 'P') lvl.start = { x, y };
      else if (ch === 'E') lvl.exit = { x, y };
      else if (ch >= 'a' && ch <= 'z') lvl.switches.push({ x, y, key: ch, pressed: false, vis: 0 });
      else if (ch >= 'A' && ch <= 'Z') lvl.doors.push({ x, y, key: ch.toLowerCase(), open: false, vis: 0 });
      lvl.tiles[y].push(tile);
    }
  }

  // Doors in a horizontal wall slide left/right; others slide up/down.
  for (const door of lvl.doors) {
    door.horizontal = tileAt(lvl, door.x - 1, door.y) === 'wall' && tileAt(lvl, door.x + 1, door.y) === 'wall';
  }
  return lvl;
}

function tileAt(lvl, x, y) {
  return (lvl.tiles[y] && lvl.tiles[y][x]) || 'void';
}

// ---------- Game state ----------
const game = {
  levelIndex: 0,
  mode: 'record',   // 'record' | 'rewind' | 'echo' | 'won'
  step: 0,          // how many steps of time have passed in this run
  player: null,
  ghost: null,
  ghostPath: null,  // positions saved during the recording; the ghost walks along it
  history: [],      // snapshot of every step in this run, used by the rewind animation
  rewind: null,
  winTimer: 0,
};

function makeEntity(x, y) {
  return { x, y, fromX: x, fromY: y, movedAt: 0, face: { x: 0, y: 1 }, bumpDir: { x: 0, y: 0 }, bumpAt: -1e9 };
}

function snapshot() {
  return {
    p: { x: game.player.x, y: game.player.y },
    g: game.ghost ? { x: game.ghost.x, y: game.ghost.y } : null,
  };
}

function currentOccupants() {
  return game.ghost ? [game.player, game.ghost] : [game.player];
}

// ---------- Rules ----------
function updateDoors(occupants) {
  const isOccupied = (x, y) => occupants.some((o) => o.x === x && o.y === y);
  const pressedKeys = new Set();

  for (const sw of level.switches) {
    sw.pressed = isOccupied(sw.x, sw.y);
    if (sw.pressed) pressedKeys.add(sw.key);
  }
  for (const door of level.doors) {
    // A door also stays open while someone is standing in the doorway.
    door.open = pressedKeys.has(door.key) || isOccupied(door.x, door.y);
  }
}

function canWalk(x, y) {
  if (tileAt(level, x, y) !== 'floor') return false;
  const door = level.doors.find((d) => d.x === x && d.y === y);
  return !door || door.open;
}

function ghostPositionAt(step) {
  // After the recording ends, the ghost stays where it stopped.
  return game.ghostPath[Math.min(step, game.ghostPath.length - 1)];
}

function takeStep(action, now) {
  const dir = DIRS[action];
  const p = game.player;

  if (action !== 'wait') {
    p.face = dir;
    if (!canWalk(p.x + dir.x, p.y + dir.y)) {
      p.bumpDir = dir;
      p.bumpAt = now;
      return false; // bumping into a wall doesn't use up time
    }
  }

  // The player and the ghost move at the same time, one step each.
  moveEntity(p, p.x + dir.x, p.y + dir.y, now);
  game.step++;
  if (game.ghost) {
    const next = ghostPositionAt(game.step);
    moveEntity(game.ghost, next.x, next.y, now);
  }

  game.history.push(snapshot());
  updateDoors(currentOccupants());

  if (p.x === level.exit.x && p.y === level.exit.y) winLevel();
  updateHud();
  return true;
}

function moveEntity(entity, x, y, now) {
  const from = renderPos(entity, now);
  if (x !== entity.x || y !== entity.y) entity.face = { x: x - entity.x, y: y - entity.y };
  entity.fromX = from.x;
  entity.fromY = from.y;
  entity.x = x;
  entity.y = y;
  entity.movedAt = now;
}

// ---------- Runs, rewinding and winning ----------
function startLevel(index) {
  if (!isUnlocked(index)) return;
  game.levelIndex = index;
  level = parseLevel(LEVELS[index]);
  setupCanvas();
  game.ghostPath = null;
  game.rewind = null;
  startRun('record');
  // Draw switches and doors in their starting state right away.
  level.switches.forEach((s) => { s.vis = s.pressed ? 1 : 0; });
  level.doors.forEach((d) => { d.vis = d.open ? 1 : 0; });
  ui.hint.textContent = level.def.hint;
  showScreen('game');
}

function startRun(mode) {
  clearTimeout(game.winTimer);
  ui.winOverlay.classList.add('hidden');
  game.mode = mode;
  game.step = 0;
  game.player = makeEntity(level.start.x, level.start.y);
  game.ghost = mode === 'echo' ? makeEntity(game.ghostPath[0].x, game.ghostPath[0].y) : null;
  game.history = [snapshot()];
  updateDoors(currentOccupants());
  updateHud();
}

function startRewind() {
  if (game.mode !== 'record' && game.mode !== 'echo') return;
  if (game.step === 0) {
    flashStatus(game.mode === 'record' ? 'Move first. There is nothing to rewind yet.' : 'You are already at the start of time.');
    return;
  }
  game.rewind = {
    startedAt: performance.now(),
    duration: Math.min(1500, Math.max(450, game.history.length * 45)),
    frames: game.history.slice(),
    // Rewinding a recording turns it into the ghost; rewinding an echo run keeps the same ghost.
    ghostPath: game.mode === 'record' ? game.history.map((s) => s.p) : game.ghostPath,
  };
  game.mode = 'rewind';
  updateHud();
}

function finishRewind() {
  game.ghostPath = game.rewind.ghostPath;
  game.rewind = null;
  startRun('echo');
}

function restartLevel() {
  if (!level) return;
  game.rewind = null;
  game.ghostPath = null;
  startRun('record');
}

function winLevel() {
  game.mode = 'won';
  progress.add(level.def.id);
  saveProgress();
  clearTimeout(game.winTimer);
  game.winTimer = setTimeout(showWinOverlay, 450); // let the last step finish animating
}

function showWinOverlay() {
  if (currentScreen !== 'game') return;
  const isLast = game.levelIndex === LEVELS.length - 1;
  const ghostSteps = game.ghostPath ? game.ghostPath.length - 1 : 0;
  ui.winTitle.textContent = isLast ? 'You escaped the ChronoVault!' : 'Vault unlocked!';
  ui.winText.textContent = isLast
    ? `All ${LEVELS.length} vaults are open. You and your past self make a good team.`
    : `Solved in ${game.step} steps.${ghostSteps ? ` Your ghost's recording was ${ghostSteps} steps long.` : ''}`;
  ui.winNext.hidden = isLast;
  ui.winOverlay.classList.remove('hidden');
}

function nextLevel() {
  if (game.levelIndex + 1 < LEVELS.length) startLevel(game.levelIndex + 1);
  else showScreen('levels');
}

// ---------- HUD ----------
let flashTimer = 0;

function updateHud() {
  const info = MODE_INFO[game.mode];
  ui.levelNum.textContent = `Level ${game.levelIndex + 1} / ${LEVELS.length}`;
  ui.levelName.textContent = level.def.name;
  ui.mode.textContent = info.badge;
  ui.mode.className = `mode-badge ${info.cls}`;
  stage.dataset.mode = info.cls;
  ui.step.textContent = game.step;

  if (game.ghostPath) {
    const total = game.ghostPath.length - 1;
    const done = Math.min(game.step, total);
    ui.ghostLabel.textContent = `Ghost ${done} / ${total}`;
    ui.ghostBar.style.width = `${(done / total) * 100}%`;
  } else {
    ui.ghostLabel.textContent = `Tape ${game.step}`;
    ui.ghostBar.style.width = '0%';
  }

  if (!flashTimer) ui.status.textContent = info.status;
}

function flashStatus(message) {
  clearTimeout(flashTimer);
  ui.status.textContent = message;
  ui.status.classList.add('flash');
  flashTimer = setTimeout(() => {
    flashTimer = 0;
    ui.status.classList.remove('flash');
    updateHud();
  }, 1800);
}

// ---------- Screens ----------
let currentScreen = 'menu';

function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('active', el.id === `screen-${name}`);
  });
  if (name !== 'game') ui.winOverlay.classList.add('hidden');
  if (name === 'levels') buildLevelGrid();
  if (name === 'menu') updateMenu();
}

function updateMenu() {
  const done = LEVELS.filter((l) => progress.has(l.id)).length;
  ui.playBtn.textContent = done > 0 && done < LEVELS.length ? '▶ Continue' : '▶ Play';
  ui.menuProgress.textContent = done ? `${done} / ${LEVELS.length} vaults unlocked` : '';
}

function buildLevelGrid() {
  ui.levelGrid.replaceChildren();
  LEVELS.forEach((def, i) => {
    const done = progress.has(def.id);
    const open = isUnlocked(i);

    const card = document.createElement('button');
    card.className = `level-card${done ? ' done' : ''}`;
    card.disabled = !open;

    const num = document.createElement('span');
    num.className = 'level-num';
    num.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'level-name';
    name.textContent = def.name;
    const state = document.createElement('span');
    state.className = 'level-state';
    state.textContent = done ? '✓ Solved' : open ? 'Play' : '🔒 Locked';

    card.append(num, name, state);
    card.addEventListener('click', () => startLevel(i));
    ui.levelGrid.append(card);
  });
}

// ---------- Canvas setup ----------
let W = 0;
let H = 0;
let dpr = 1;

function setupCanvas() {
  W = level.cols * TILE;
  H = level.rows * TILE;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  fitToScreen();
}

// Shrink the board on short screens so the HUD and buttons stay visible.
function fitToScreen() {
  if (!level) return;
  const reserved = window.innerWidth <= 640 ? 360 : 250;
  const maxByHeight = Math.max(260, (window.innerHeight - reserved) * (W / H));
  gameWrap.style.maxWidth = `${Math.min(W, maxByHeight)}px`;
}

// ---------- Drawing helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const mid = (v) => v * TILE + TILE / 2;
const lerpPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function renderPos(entity, now) {
  const t = easeOut(clamp((now - entity.movedAt) / MOVE_MS, 0, 1));
  return { x: entity.fromX + (entity.x - entity.fromX) * t, y: entity.fromY + (entity.y - entity.fromY) * t };
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- Drawing: board ----------
function drawFloor(x, y) {
  const px = x * TILE;
  const py = y * TILE;
  ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
  ctx.fillRect(px, py, TILE, TILE);
  // soft shadow cast by a wall above
  if (tileAt(level, x, y - 1) === 'wall') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(px, py, TILE, 6);
  }
}

function drawWall(x, y) {
  const px = x * TILE;
  const py = y * TILE;
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = COLORS.wallRim;
  if (tileAt(level, x, y - 1) !== 'wall') ctx.fillRect(px, py, TILE, 3);
  if (tileAt(level, x - 1, y) === 'floor') ctx.fillRect(px, py, 2, TILE);
  if (tileAt(level, x + 1, y) === 'floor') ctx.fillRect(px + TILE - 2, py, 2, TILE);
  // darker front face when there is floor below, for a little depth
  if (tileAt(level, x, y + 1) === 'floor') {
    ctx.fillStyle = COLORS.wallFace;
    ctx.fillRect(px, py + TILE * 0.72, TILE, TILE * 0.28);
  }
}

function drawExit(now) {
  const cx = mid(level.exit.x);
  const cy = mid(level.exit.y);
  const pulse = (Math.sin(now / 280) + 1) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(157, 255, 110, 0.14)';
  ctx.fillRect(cx - TILE / 2 + 3, cy - TILE / 2 + 3, TILE - 6, TILE - 6);
  ctx.strokeStyle = COLORS.exit;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = COLORS.exit;
  ctx.shadowBlur = 10 + pulse * 10;
  for (let i = 0; i < 3; i++) {
    const half = TILE * (0.1 + i * 0.11) + pulse * 2;
    ctx.globalAlpha = 1 - i * 0.28;
    roundRectPath(cx - half, cy - half, half * 2, half * 2, 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSwitch(sw) {
  const color = KEY_COLORS[sw.key] || '#ffffff';
  const cx = mid(sw.x);
  const cy = mid(sw.y);
  const p = sw.vis; // 0 = up, 1 = pressed
  ctx.save();

  // base plate
  roundRectPath(cx - TILE * 0.34, cy - TILE * 0.34, TILE * 0.68, TILE * 0.68, 8);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45 + 0.55 * p;
  ctx.stroke();

  // button: glows and sinks a little when pressed
  ctx.globalAlpha = 0.35 + 0.65 * p;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20 * p;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, TILE * (0.2 - 0.03 * p), 0, Math.PI * 2);
  ctx.fill();

  // letter, so colors are never the only clue
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = p > 0.5 ? '#0a0f1f' : color;
  ctx.font = `800 ${Math.round(TILE * 0.26)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sw.key.toUpperCase(), cx, cy + 1);
  ctx.restore();
}

function drawDoor(door) {
  const color = KEY_COLORS[door.key] || '#ffffff';
  const px = door.x * TILE;
  const py = door.y * TILE;
  const closed = 1 - door.vis; // 1 = fully closed, 0 = fully open
  const inset = 3;
  const inner = TILE - inset * 2;
  ctx.save();

  // dashed frame is always visible, so an open door is still easy to spot
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(px + inset, py + inset, inner, inner);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  if (closed > 0.02) {
    // two panels that slide apart as the door opens
    const size = (inner / 2) * closed;
    const panels = door.horizontal
      ? [[px + inset, py + inset, size, inner], [px + TILE - inset - size, py + inset, size, inner]]
      : [[px + inset, py + inset, inner, size], [px + inset, py + TILE - inset - size, inner, size]];

    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * closed;
    ctx.fillStyle = color;
    panels.forEach((r) => ctx.fillRect(...r));
    ctx.shadowBlur = 0;

    // hazard stripes
    ctx.beginPath();
    panels.forEach((r) => ctx.rect(...r));
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 5;
    for (let s = -TILE; s < TILE * 2; s += 12) {
      ctx.beginPath();
      ctx.moveTo(px + s, py);
      ctx.lineTo(px + s - TILE, py + TILE);
      ctx.stroke();
    }

    if (closed > 0.6) {
      ctx.fillStyle = 'rgba(10, 15, 31, 0.85)';
      ctx.font = `800 ${Math.round(TILE * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(door.key.toUpperCase(), px + TILE / 2, py + TILE / 2 + 1);
    }
  }
  ctx.restore();
}

function drawBoard(now) {
  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      const tile = level.tiles[y][x];
      if (tile === 'floor') drawFloor(x, y);
      else if (tile === 'wall') drawWall(x, y);
    }
  }
  drawExit(now);
  level.switches.forEach(drawSwitch);
  level.doors.forEach(drawDoor);
}

// ---------- Drawing: paths, player and ghost ----------
function drawPath(points, color, alpha) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([2, 8]);
  ctx.beginPath();
  points.forEach((pt, i) => (i ? ctx.lineTo(mid(pt.x), mid(pt.y)) : ctx.moveTo(mid(pt.x), mid(pt.y))));
  ctx.stroke();
  ctx.restore();
}

function drawTrails(playerPos, ghostPos) {
  if (game.mode === 'record') {
    // the tape so far
    const trail = game.history.slice(0, -1).map((s) => s.p);
    drawPath([...trail, playerPos], COLORS.player, 0.45);
  } else if (game.mode === 'echo' && ghostPos) {
    // where the ghost is going to walk, and where it will stop
    const last = game.ghostPath.length - 1;
    if (game.step < last) {
      drawPath([ghostPos, ...game.ghostPath.slice(game.step + 1)], COLORS.ghost, 0.5);
      const end = game.ghostPath[last];
      ctx.save();
      ctx.strokeStyle = COLORS.ghost;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(mid(end.x), mid(end.y), TILE * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawShadow(cx, cy, r) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.95, r * 0.8, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEyes(cx, cy, r, face, color) {
  const lookX = face.x * r * 0.22;
  const lookY = face.y * r * 0.18;
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * r * 0.34 + lookX, cy - r * 0.08 + lookY, r * 0.12, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(pos, now) {
  const p = game.player;
  let { x, y } = pos;
  const bump = (now - p.bumpAt) / 160;
  if (bump < 1) {
    const k = Math.sin(bump * Math.PI) * 0.12;
    x += p.bumpDir.x * k;
    y += p.bumpDir.y * k;
  }
  const cx = mid(x);
  const cy = mid(y);
  const r = TILE * 0.3;

  ctx.save();
  drawShadow(cx, cy, r);
  ctx.shadowColor = COLORS.player;
  ctx.shadowBlur = 16;
  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.42, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  drawEyes(cx, cy, r, p.face, '#05202c');
  ctx.restore();
}

function drawGhost(pos, now) {
  const cx = mid(pos.x);
  const cy = mid(pos.y) + Math.sin(now / 300) * TILE * 0.03; // gentle float
  const r = TILE * 0.3;
  const top = cy - r * 0.2;
  const bottom = cy + r * 0.9;
  const wobble = Math.sin(now / 150) * r * 0.08;

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.shadowColor = COLORS.ghost;
  ctx.shadowBlur = 14;
  ctx.fillStyle = COLORS.ghost;
  ctx.beginPath();
  ctx.arc(cx, top, r, Math.PI, 0);
  ctx.lineTo(cx + r, bottom);
  const waves = 3;
  const w = (2 * r) / waves;
  for (let i = 0; i < waves; i++) {
    const x0 = cx + r - i * w;
    ctx.quadraticCurveTo(x0 - w / 2, bottom - r * 0.35 + wobble, x0 - w, bottom);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  drawEyes(cx, top + r * 0.15, r, game.ghost ? game.ghost.face : { x: 0, y: 1 }, '#1b1030');
  ctx.restore();
}

function drawRewindEffect(now) {
  ctx.save();
  ctx.fillStyle = 'rgba(70, 110, 255, 0.14)';
  ctx.fillRect(0, 0, W, H);
  // VHS-style scanlines and a rolling bright band
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  const bandY = ((now / 2.5) % (H + 80)) - 80;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(0, bandY, W, 50);
  // blinking label
  ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 90);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(TILE * 0.42)}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('◀◀ REWIND', 14, 12);
  ctx.restore();
}

// Ease switch glow and door panels toward their real state.
function animateVisuals(dt) {
  const k = Math.min(1, dt / 70);
  for (const s of level.switches) s.vis += ((s.pressed ? 1 : 0) - s.vis) * k;
  for (const d of level.doors) d.vis += ((d.open ? 1 : 0) - d.vis) * k;
}

function render(now, dt) {
  let playerPos;
  let ghostPos = null;

  if (game.mode === 'rewind') {
    // Play the history backwards, fast.
    const r = game.rewind;
    const t = clamp((now - r.startedAt) / r.duration, 0, 1);
    const idx = (r.frames.length - 1) * (1 - easeInOut(t));
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, r.frames.length - 1);
    const a = r.frames[i0];
    const b = r.frames[i1];
    playerPos = lerpPoint(a.p, b.p, idx - i0);
    if (a.g) ghostPos = lerpPoint(a.g, b.g, idx - i0);
    const nearest = r.frames[Math.round(idx)];
    updateDoors(nearest.g ? [nearest.p, nearest.g] : [nearest.p]);
    if (t >= 1) finishRewind();
  } else {
    playerPos = renderPos(game.player, now);
    if (game.ghost) ghostPos = renderPos(game.ghost, now);
  }

  animateVisuals(dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoard(now);
  drawTrails(playerPos, ghostPos);
  if (ghostPos) drawGhost(ghostPos, now);
  drawPlayer(playerPos, now);
  if (game.mode === 'rewind') drawRewindEffect(now);
}

let lastFrame = performance.now();

function loop(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  if (currentScreen === 'game' && level) render(now, dt);
  requestAnimationFrame(loop);
}

// ---------- Input ----------
let lastStepAt = 0;

function doAction(action) {
  if (game.mode !== 'record' && game.mode !== 'echo') return;
  const now = performance.now();
  if (takeStep(action, now)) lastStepAt = now;
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (currentScreen !== 'game') {
    if (e.code === 'Escape' && currentScreen !== 'menu') showScreen('menu');
    return;
  }

  const action = KEY_ACTIONS[e.code];
  if (action) {
    e.preventDefault();
    if (e.repeat && performance.now() - lastStepAt < REPEAT_MS) return;
    doAction(action);
    return;
  }

  if (e.repeat) return;
  switch (e.code) {
    case 'KeyR':
      startRewind();
      break;
    case 'Backspace':
    case 'Delete':
      e.preventDefault();
      restartLevel();
      break;
    case 'Escape':
      showScreen('levels');
      break;
    case 'Enter':
    case 'NumpadEnter':
      if (game.mode === 'won') {
        e.preventDefault();
        nextLevel();
      }
      break;
  }
});

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    doAction(btn.dataset.act);
  });
});

document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.goto));
});

ui.playBtn.addEventListener('click', () => {
  const next = LEVELS.findIndex((l) => !progress.has(l.id));
  if (next === -1) showScreen('levels');
  else startLevel(next);
});

$('btn-reset-progress').addEventListener('click', () => {
  if (!confirm('Reset all saved progress?')) return;
  progress.clear();
  saveProgress();
  buildLevelGrid();
});

$('btn-rewind').addEventListener('click', startRewind);
$('btn-restart').addEventListener('click', restartLevel);
$('btn-levels').addEventListener('click', () => showScreen('levels'));
ui.winNext.addEventListener('click', nextLevel);
$('win-replay').addEventListener('click', restartLevel);
$('win-levels').addEventListener('click', () => showScreen('levels'));

// Don't let clicked buttons keep focus, so Space/Enter keep controlling the game.
$('screen-game').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) btn.blur();
});

window.addEventListener('resize', fitToScreen);

// ---------- Start ----------
updateMenu();
requestAnimationFrame(loop);
