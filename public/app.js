import { BOARD_SIZE, DIFFICULTIES, createGame, startGame, turn, tick, togglePause, getTickMs } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#board');
const context = canvas.getContext('2d');
const overlay = $('#overlay');
const startButton = $('#start-button');
const pauseButton = $('#pause-button');
const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
const STORAGE_KEY = 'snake-garden.best.v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = createGame();
let bestScores = readBestScores();
let soundEnabled = false;
let audioContext;
let lastTime = 0;
let elapsed = 0;
let boardPixels = 720;
let particles = [];
let pointerStart = null;
let storageAvailable = true;

function readBestScores() {
  const result = { easy: 0, normal: 0, hard: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    for (const difficulty of Object.keys(result)) {
      const value = stored?.[difficulty];
      if (Number.isSafeInteger(value) && value >= 0) result[difficulty] = value;
    }
  } catch {
    // The game still works when storage is disabled or its data is invalid.
  }
  return result;
}

function saveBestScore() {
  if (state.score <= bestScores[state.difficulty]) return;
  bestScores[state.difficulty] = state.score;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bestScores));
  } catch {
    storageAvailable = false;
  }
}

function announce(message) {
  $('#live-message').textContent = message;
}

function updateInterface() {
  const active = state.status === 'running' || state.status === 'paused';
  $('#score').textContent = String(state.score).padStart(3, '0');
  $('#best-score').textContent = String(bestScores[state.difficulty]).padStart(3, '0');
  $('#best-score').title = storageAvailable ? '仅保存在当前浏览器中' : '浏览器存储不可用，纪录仅保留到本页关闭';
  $('#food-count').textContent = state.foodsEaten;
  $('#snake-length').textContent = state.snake.length;
  $('#state-label').textContent = {
    ready: '准备就绪', running: '生长进行中', paused: '休息一下', gameover: '下次会更好', won: '花园大丰收',
  }[state.status];
  pauseButton.disabled = !active;
  $('#pause-label').textContent = state.status === 'paused' ? '继续' : '暂停';
  for (const button of difficultyButtons) {
    const selected = button.dataset.difficulty === state.difficulty;
    button.disabled = active;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  $('#difficulty-note').textContent = active
    ? `每颗果子 +${DIFFICULTIES[state.difficulty].points} 分 · 本局结束后可切换难度`
    : `每颗果子 +${DIFFICULTIES[state.difficulty].points} 分 · 越吃越快`;
  overlay.hidden = state.status === 'running';
  if (state.status === 'running') return;

  const views = {
    ready: ['A FRESH START', '来一局？', '一颗果子，一点快乐。\n让你的小蛇在这片花园里长大。', '开始游戏', '或按 Enter 开始'],
    paused: ['TAKE YOUR TIME', '歇一小会儿。', '花园会在这里等你。\n准备好了，就接着长大。', '继续游戏', '或按空格继续'],
    gameover: ['GROW, TRY, REPEAT', '再长大一点点。', `这次收获 ${state.score} 分，吃掉 ${state.foodsEaten} 颗果子。\n下一局，也许就能打破纪录。`, '再来一局', '或按 Enter 重新开始'],
    won: ['A GARDEN FULL OF JOY', '你种满了快乐！', `整片花园都是你的小蛇。\n最终得分 ${state.score}，这是一场大丰收。`, '再玩一次', '或按 Enter 重新开始'],
  };
  const [kicker, title, description, buttonLabel, shortcut] = views[state.status];
  $('#overlay-kicker').textContent = kicker;
  $('#overlay-title').textContent = title;
  $('#overlay-description').textContent = description;
  $('#start-label').textContent = buttonLabel;
  $('#overlay-shortcut').textContent = shortcut;
}

function resetClock() {
  elapsed = 0;
  lastTime = performance.now();
}

function begin() {
  state = createGame({ difficulty: state.difficulty });
  startGame(state);
  particles = [];
  resetClock();
  prepareAudio();
  updateInterface();
  canvas.focus({ preventScroll: true });
  announce(`${DIFFICULTIES[state.difficulty].label}模式，游戏开始。`);
}

function pauseOrResume() {
  if (!['running', 'paused'].includes(state.status)) return;
  togglePause(state);
  resetClock();
  updateInterface();
  if (state.status === 'running') canvas.focus({ preventScroll: true });
  announce(state.status === 'paused' ? '游戏已暂停。' : '游戏继续。');
}

function primaryAction() {
  if (state.status === 'paused') pauseOrResume();
  else begin();
}

function prepareAudio() {
  if (!soundEnabled) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch {
    soundEnabled = false;
    updateSoundButton();
    announce('此浏览器暂不支持音效，仍可正常游戏。');
  }
}

function playSound(event) {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const notes = event === 'eat' ? [520, 780] : event === 'won' ? [520, 660, 780, 1040] : [240, 150];
  notes.forEach((frequency, index) => {
    const at = audioContext.currentTime + index * 0.085;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.055, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.16);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

function updateSoundButton() {
  $('#sound-button').setAttribute('aria-pressed', String(soundEnabled));
  $('#sound-label').textContent = soundEnabled ? '音效开启' : '音效关闭';
  $('#sound-icon').setAttribute('d', soundEnabled
    ? 'm11 5-5 4H3v6h3l5 4ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'
    : 'm11 5-5 4H3v6h3l5 4ZM16 8l5 8m0-8-5 8');
}

function resizeBoard() {
  const size = canvas.getBoundingClientRect().width;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * ratio);
  canvas.height = canvas.width;
  boardPixels = canvas.width;
  drawBoard(performance.now());
}

function roundedRect(x, y, width, height, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function drawFood(food, unit) {
  if (!food) return;
  const x = (food.x + 0.5) * unit;
  const y = (food.y + 0.5) * unit;
  context.fillStyle = '#c77c59';
  context.beginPath();
  context.ellipse(x, y + unit * 0.06, unit * 0.31, unit * 0.32, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#e49c72';
  context.beginPath();
  context.arc(x - unit * 0.09, y - unit * 0.04, unit * 0.14, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#6f8b4f';
  context.beginPath();
  context.ellipse(x + unit * 0.1, y - unit * 0.31, unit * 0.14, unit * 0.065, -0.6, 0, Math.PI * 2);
  context.fill();
}

function drawSnake(snake, direction, unit) {
  // Join adjacent segments before painting rounded cells to keep one continuous body.
  context.strokeStyle = '#6d8d4d';
  context.lineWidth = unit * 0.76;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  snake.forEach((segment, index) => {
    const point = [(segment.x + 0.5) * unit, (segment.y + 0.5) * unit];
    if (index === 0) context.moveTo(...point);
    else context.lineTo(...point);
  });
  context.stroke();
  for (let i = snake.length - 1; i >= 0; i -= 1) {
    const segment = snake[i];
    const inset = unit * 0.1;
    roundedRect(segment.x * unit + inset, segment.y * unit + inset, unit * 0.8, unit * 0.8, unit * 0.22,
      i === 0 ? '#31573a' : i % 2 === 0 ? '#779451' : '#6d8d4d');
  }
  const head = snake[0];
  const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const [dx, dy] = vectors[direction];
  for (const side of [-1, 1]) {
    const x = (head.x + 0.5 + dx * 0.18 + dy * side * 0.18) * unit;
    const y = (head.y + 0.5 + dy * 0.18 + dx * side * 0.18) * unit;
    context.fillStyle = '#eff3df';
    context.beginPath();
    context.arc(x, y, unit * 0.095, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#263e31';
    context.beginPath();
    context.arc(x + dx * unit * 0.025, y + dy * unit * 0.025, unit * 0.045, 0, Math.PI * 2);
    context.fill();
  }
}

function drawBoard(now) {
  const unit = boardPixels / BOARD_SIZE;
  context.clearRect(0, 0, boardPixels, boardPixels);
  context.fillStyle = '#eaf0dc';
  context.fillRect(0, 0, boardPixels, boardPixels);
  context.strokeStyle = '#dfe7d0';
  context.lineWidth = Math.max(0.5, boardPixels / 1000);
  context.beginPath();
  for (let index = 1; index < BOARD_SIZE; index += 1) {
    context.moveTo(index * unit, 0);
    context.lineTo(index * unit, boardPixels);
    context.moveTo(0, index * unit);
    context.lineTo(boardPixels, index * unit);
  }
  context.stroke();
  drawFood(state.food, unit);
  drawSnake(state.snake, state.direction, unit);
  particles = particles.filter((particle) => now - particle.born < 350);
  for (const particle of particles) {
    const age = (now - particle.born) / 350;
    context.globalAlpha = 1 - age;
    context.fillStyle = '#c88b61';
    context.beginPath();
    context.arc((particle.x + particle.dx * age) * unit, (particle.y + particle.dy * age) * unit, unit * 0.07, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function burst(food, now) {
  if (reducedMotion || !food) return;
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    particles.push({ x: food.x + 0.5, y: food.y + 0.5, dx: Math.cos(angle) * 1.2, dy: Math.sin(angle) * 1.2, born: now });
  }
}

function frame(now) {
  const delta = lastTime ? Math.min(now - lastTime, 250) : 0;
  lastTime = now;
  if (state.status === 'running') {
    elapsed += delta;
    while (elapsed >= getTickMs(state) && state.status === 'running') {
      elapsed -= getTickMs(state);
      const oldFood = state.food;
      const event = tick(state);
      if (event === 'eat' || event === 'won') {
        burst(oldFood, now);
        saveBestScore();
        playSound(event);
        updateInterface();
      }
      if (event === 'dead' || event === 'won') {
        if (event === 'dead') playSound(event);
        updateInterface();
        announce(`${event === 'won' ? '恭喜获胜' : '游戏结束'}！本局 ${state.score} 分，吃掉 ${state.foodsEaten} 颗果子。`);
        startButton.focus({ preventScroll: true });
      }
    }
  }
  drawBoard(now);
  requestAnimationFrame(frame);
}

const keyDirections = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (keyDirections[key]) {
    event.preventDefault();
    if (!event.repeat) turn(state, keyDirections[key]);
  } else if (key === 'r') {
    event.preventDefault();
    if (!event.repeat) begin();
  } else if ((key === ' ' || key === 'Enter') && !event.target.closest('button, a')) {
    event.preventDefault();
    if (event.repeat) return;
    if (key === ' ') pauseOrResume();
    else if (state.status !== 'running') primaryAction();
  }
});

startButton.addEventListener('click', primaryAction);
pauseButton.addEventListener('click', pauseOrResume);
$('#restart-button').addEventListener('click', begin);
$('#sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  prepareAudio();
  updateSoundButton();
  if (soundEnabled) playSound('eat');
});

for (const button of difficultyButtons) {
  button.addEventListener('click', () => {
    if (state.status === 'running' || state.status === 'paused') return;
    state = createGame({ difficulty: button.dataset.difficulty });
    particles = [];
    updateInterface();
    announce(`已选择${DIFFICULTIES[state.difficulty].label}模式。`);
  });
}

for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    turn(state, button.dataset.direction);
  });
  // Keep the direction controls usable by keyboard and assistive technology.
  button.addEventListener('click', (event) => {
    if (event.detail === 0) turn(state, button.dataset.direction);
  });
}

canvas.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointerStart || event.pointerId !== pointerStart.id) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
  turn(state, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});
function clearPointer(event) {
  if (pointerStart?.id === event.pointerId) pointerStart = null;
}
canvas.addEventListener('pointerup', clearPointer);
canvas.addEventListener('pointercancel', clearPointer);
canvas.addEventListener('lostpointercapture', clearPointer);

function pauseWhenAway() {
  pointerStart = null;
  if (state.status === 'running') pauseOrResume();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseWhenAway();
});
window.addEventListener('blur', pauseWhenAway);
new ResizeObserver(resizeBoard).observe(canvas);
updateInterface();
resizeBoard();
requestAnimationFrame(frame);
