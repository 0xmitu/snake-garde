import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, DIFFICULTIES, createGame, startGame, turn, tick, togglePause, getTickMs } from '../public/engine.js';

const firstCell = () => 0;

function running(options = {}) {
  const state = createGame({ random: firstCell, ...options });
  startGame(state);
  return state;
}

test('a fresh game has a centered snake and food on an unoccupied cell', () => {
  const state = createGame({ random: firstCell });
  assert.equal(state.size, BOARD_SIZE);
  assert.equal(state.status, 'ready');
  assert.equal(state.difficulty, 'normal');
  assert.equal(state.direction, 'right');
  assert.equal(state.snake.length, 3);
  assert.deepEqual(state.snake[0], { x: 12, y: 12 });
  assert.deepEqual(state.food, { x: 0, y: 0 });
  assert.deepEqual(state.directionQueue, []);
  assert.equal(state.score, 0);
  assert.equal(state.foodsEaten, 0);
  assert.equal(state.ticks, 0);
});

test('new games do not share mutable arrays or positions', () => {
  const first = createGame({ random: firstCell });
  const second = createGame({ random: firstCell });
  first.snake[0].x = 1;
  first.directionQueue.push('up');
  assert.equal(second.snake[0].x, 12);
  assert.deepEqual(second.directionQueue, []);
  assert.ok(Object.isFrozen(DIFFICULTIES));
  assert.ok(Object.isFrozen(DIFFICULTIES.normal));
});

test('size, difficulty, and random inputs are validated', () => {
  for (const size of [0, 3, 4.5, 129, NaN, Infinity, '24']) {
    assert.throws(() => createGame({ size }), RangeError);
  }
  for (const difficulty of ['unknown', 'constructor', '__proto__', null]) {
    assert.throws(() => createGame({ difficulty }), RangeError);
  }
  assert.throws(() => createGame({ random: 0 }), TypeError);
  for (const value of [-0.1, 1, Infinity, NaN, '0']) {
    assert.throws(() => createGame({ random: () => value }), RangeError);
  }
  assert.equal(createGame({ size: 4, random: firstCell }).size, 4);
  assert.equal(createGame({ size: 128, random: firstCell }).size, 128);
});

test('food sampling reaches every free cell and never overlaps the snake', () => {
  const size = 4;
  const freeCount = size * size - 3;
  const seen = new Set();
  for (let index = 0; index < freeCount; index += 1) {
    const state = createGame({ size, random: () => (index + 0.5) / freeCount });
    assert.ok(!state.snake.some(({ x, y }) => x === state.food.x && y === state.food.y));
    seen.add(`${state.food.x},${state.food.y}`);
  }
  assert.equal(seen.size, freeCount);
  assert.deepEqual(createGame({ size, random: () => 1 - Number.EPSILON }).food, { x: 3, y: 3 });
});

test('start and pause obey the round lifecycle', () => {
  const state = createGame({ random: firstCell });
  assert.equal(togglePause(state), false);
  assert.equal(startGame(state), true);
  assert.equal(startGame(state), false);
  assert.equal(togglePause(state), true);
  assert.equal(state.status, 'paused');
  assert.equal(startGame(state), false);
  assert.equal(togglePause(state), true);
  assert.equal(state.status, 'running');
  state.status = 'gameover';
  assert.equal(togglePause(state), false);
  assert.equal(startGame(state), false);
});

test('ready, paused, lost, and won games do not move or accept turns', () => {
  for (const status of ['ready', 'paused', 'gameover', 'won']) {
    const state = createGame({ random: firstCell });
    state.status = status;
    const before = structuredClone(state);
    assert.equal(tick(state), 'idle');
    assert.equal(turn(state, 'up'), false);
    assert.deepEqual(state, before);
  }
});

test('an ordinary tick advances the head and removes the tail', () => {
  const state = running();
  assert.equal(tick(state), 'move');
  assert.deepEqual(state.snake, [{ x: 13, y: 12 }, { x: 12, y: 12 }, { x: 11, y: 12 }]);
  assert.equal(state.ticks, 1);
  assert.equal(state.score, 0);
});

test('turns reject reversals, duplicate directions, and unknown directions', () => {
  const state = running();
  for (const direction of ['left', 'right', 'north', 'constructor', '__proto__', null]) {
    assert.equal(turn(state, direction), false);
  }
  assert.equal(turn(state, 'up'), true);
  assert.equal(turn(state, 'down'), false);
  assert.equal(turn(state, 'up'), false);
  assert.deepEqual(state.directionQueue, ['up']);
});

test('two rapid turns are consumed across two ticks and queue overflow is ignored', () => {
  const state = running();
  assert.equal(turn(state, 'up'), true);
  assert.equal(turn(state, 'left'), true);
  assert.equal(turn(state, 'down'), false);
  assert.equal(tick(state), 'move');
  assert.equal(state.direction, 'up');
  assert.deepEqual(state.snake[0], { x: 12, y: 11 });
  assert.deepEqual(state.directionQueue, ['left']);
  assert.equal(tick(state), 'move');
  assert.equal(state.direction, 'left');
  assert.deepEqual(state.snake[0], { x: 11, y: 11 });
  assert.deepEqual(state.directionQueue, []);
});

test('eating grows the snake, awards difficulty points, and replaces food', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const state = running({ difficulty });
    state.food = { x: 13, y: 12 };
    assert.equal(tick(state, firstCell), 'eat');
    assert.equal(state.snake.length, 4);
    assert.equal(state.score, DIFFICULTIES[difficulty].points);
    assert.equal(state.foodsEaten, 1);
    assert.deepEqual(state.food, { x: 0, y: 0 });
    assert.equal(state.status, 'running');
  }
});

test('invalid food randomness cannot partially commit a move', () => {
  const state = running();
  turn(state, 'up');
  state.food = { x: 12, y: 11 };
  const before = structuredClone(state);
  assert.throws(() => tick(state, () => 1), RangeError);
  assert.deepEqual(state, before);
  assert.throws(() => tick(state, null), TypeError);
  assert.deepEqual(state, before);
});

test('hitting any wall ends the round without placing the head outside the board', () => {
  const cases = [
    { direction: 'left', head: { x: 0, y: 4 } },
    { direction: 'right', head: { x: 23, y: 4 } },
    { direction: 'up', head: { x: 4, y: 0 } },
    { direction: 'down', head: { x: 4, y: 23 } },
  ];
  for (const { direction, head } of cases) {
    const state = running();
    state.direction = direction;
    state.snake = [head];
    assert.equal(tick(state), 'dead');
    assert.equal(state.status, 'gameover');
    assert.deepEqual(state.snake[0], head);
    assert.equal(tick(state), 'idle');
  }
});

test('hitting the body ends the round', () => {
  const state = running();
  state.snake = [
    { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 },
    { x: 3, y: 2 }, { x: 3, y: 1 },
  ];
  assert.equal(tick(state), 'dead');
  assert.equal(state.status, 'gameover');
  assert.equal(state.score, 0);
});

test('the head may enter the cell vacated by the tail on the same tick', () => {
  const state = running();
  state.snake = [
    { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 },
  ];
  assert.equal(tick(state), 'move');
  assert.deepEqual(state.snake[0], { x: 3, y: 2 });
  assert.equal(state.snake.length, 4);
  assert.equal(state.status, 'running');
});

test('eating the final free cell wins without calling the RNG or looping', () => {
  const state = running({ size: 4 });
  state.direction = 'right';
  state.snake = [
    { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 },
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 },
    { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
  ];
  state.food = { x: 3, y: 0 };
  assert.equal(tick(state, () => assert.fail('A full board needs no new food.')), 'won');
  assert.equal(state.status, 'won');
  assert.equal(state.snake.length, 16);
  assert.equal(new Set(state.snake.map(({ x, y }) => `${x},${y}`)).size, 16);
  assert.equal(state.food, null);
  assert.equal(state.score, DIFFICULTIES.normal.points);
  assert.equal(tick(state), 'idle');
});

test('the game speeds up after eating, with a 55 ms minimum interval', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const state = running({ difficulty });
    assert.equal(getTickMs(state), DIFFICULTIES[difficulty].tickMs);
    state.foodsEaten = 5;
    assert.equal(getTickMs(state), DIFFICULTIES[difficulty].tickMs - 15);
    state.foodsEaten = 1000;
    assert.equal(getTickMs(state), 55);
  }
});
