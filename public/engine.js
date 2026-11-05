/** Pure game rules shared by the browser and the Node.js test suite. */
export const BOARD_SIZE = 24;

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ label: '悠闲', tickMs: 180, points: 10 }),
  normal: Object.freeze({ label: '经典', tickMs: 125, points: 20 }),
  hard: Object.freeze({ label: '极速', tickMs: 85, points: 30 }),
});

const VECTORS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

/** Select uniformly from free cells, without a retry loop on a nearly full board. */
function placeFood(size, snake, random) {
  const occupied = new Set(snake.map(({ x, y }) => y * size + x));
  const freeCount = size * size - occupied.size;
  if (freeCount === 0) return null;

  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('random() must return a finite number in [0, 1).');
  }

  let selected = Math.floor(sample * freeCount);
  for (let cell = 0; cell < size * size; cell += 1) {
    if (occupied.has(cell)) continue;
    if (selected === 0) return { x: cell % size, y: Math.floor(cell / size) };
    selected -= 1;
  }
  throw new Error('Could not place food on the board.');
}

export function createGame({ size = BOARD_SIZE, difficulty = 'normal', random = Math.random } = {}) {
  if (!Number.isInteger(size) || size < 4 || size > 128) {
    throw new RangeError('size must be an integer from 4 to 128.');
  }
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) {
    throw new RangeError('difficulty must be easy, normal, or hard.');
  }
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function.');
  }

  const center = Math.floor(size / 2);
  const snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];

  return {
    size,
    difficulty,
    snake,
    direction: 'right',
    directionQueue: [],
    food: placeFood(size, snake, random),
    score: 0,
    foodsEaten: 0,
    status: 'ready',
    ticks: 0,
  };
}

/** Start a fresh round. Finished rounds must be replaced with createGame(). */
export function startGame(state) {
  if (state.status !== 'ready') return false;
  state.status = 'running';
  return true;
}

/** Buffer at most two turns so a fast corner cannot reverse into the snake. */
export function turn(state, direction) {
  if (state.status !== 'running' || !Object.hasOwn(VECTORS, direction)) return false;
  if (state.directionQueue.length >= 2) return false;

  const previous = state.directionQueue.at(-1) ?? state.direction;
  const before = VECTORS[previous];
  const after = VECTORS[direction];
  if (direction === previous || (before.x + after.x === 0 && before.y + after.y === 0)) {
    return false;
  }

  state.directionQueue.push(direction);
  return true;
}

/** Advance exactly one cell. Callers own timing, rendering, and persistence. */
export function tick(state, random = Math.random) {
  if (state.status !== 'running') return 'idle';
  if (typeof random !== 'function') throw new TypeError('random must be a function.');

  const direction = state.directionQueue[0] ?? state.direction;
  const delta = VECTORS[direction];
  const head = { x: state.snake[0].x + delta.x, y: state.snake[0].y + delta.y };
  const eating = state.food !== null && sameCell(head, state.food);
  // On an ordinary move the tail vacates its cell at the same time as the head moves.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  const collided = head.x < 0 || head.y < 0 || head.x >= state.size || head.y >= state.size
    || body.some((cell) => sameCell(cell, head));

  if (collided) {
    state.direction = direction;
    state.directionQueue.length = 0;
    state.ticks += 1;
    state.status = 'gameover';
    return 'dead';
  }

  const nextSnake = [head, ...body];
  // Compute food before committing the move so an invalid custom RNG cannot partly mutate state.
  const nextFood = eating ? placeFood(state.size, nextSnake, random) : state.food;
  state.direction = direction;
  state.directionQueue.shift();
  state.snake = nextSnake;
  state.ticks += 1;

  if (!eating) return 'move';

  state.score += DIFFICULTIES[state.difficulty].points;
  state.foodsEaten += 1;
  state.food = nextFood;
  if (nextFood === null) {
    state.status = 'won';
    state.directionQueue.length = 0;
    return 'won';
  }
  return 'eat';
}

export function togglePause(state) {
  if (state.status === 'running') {
    state.status = 'paused';
    return true;
  }
  if (state.status === 'paused') {
    state.status = 'running';
    return true;
  }
  return false;
}

/** Each apple shortens the interval by 3 ms, down to a playable 55 ms floor. */
export function getTickMs(state) {
  return Math.max(55, DIFFICULTIES[state.difficulty].tickMs - state.foodsEaten * 3);
}
