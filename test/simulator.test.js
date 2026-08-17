const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadSimulator() {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const core = script
    .slice(script.indexOf('const levels='), script.indexOf('function render()'))
    .replace(/const sel=[\s\S]*?;\n/, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${core}; globalThis.__simulate = simulate; globalThis.__simulateHousehold = typeof simulateHousehold === 'undefined' ? undefined : simulateHousehold; globalThis.__simulateExpansion = typeof simulateExpansion === 'undefined' ? undefined : simulateExpansion;`, context);
  return { simulate: context.__simulate, simulateHousehold: context.__simulateHousehold, simulateExpansion: context.__simulateExpansion };
}

test('a completed day-12 campaign frees its active slot for cleared funds while earnings stay held until day 19', () => {
  const { simulate } = loadSimulator();
  const result = simulate(42, 12, 'same', '1', 13, 0);

  assert.equal(result.cycles.filter(cycle => cycle.start === 0).length, 3);
  assert.equal(result.cycles.filter(cycle => cycle.start === 12).length, 1);
  assert.equal(result.cycles.find(cycle => cycle.start === 12).ready, 31);
  assert.equal(result.cash, 2);
});

test('the three-campaign account limit still blocks a fourth start before click completion', () => {
  const { simulate } = loadSimulator();
  const result = simulate(42, 11, 'same', '1', 13, 0);

  assert.equal(result.cycles.length, 3);
});

test('time compression never exceeds three campaigns awaiting click completion', () => {
  const { simulate } = loadSimulator();
  const result = simulate(42, 90, 'ladder', '1', 13, 13);

  for (let day = 0; day <= 90; day += 1) {
    const active = result.cycles.filter(cycle => cycle.start <= day && cycle.clickDone > day);
    assert.ok(active.length <= 3, `day ${day} has ${active.length} active campaigns`);
  }
});

test('household comparison is visibly isolated per eligible adult and bound to the household/IP limit', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(html, /per eligible adult account/i);
  assert.match(html, /up to 3 accounts total per household\/IP/i);
  assert.match(html, /not a way for one person to run multiple accounts/i);
});

test('a coordinated three-account view runs all eligible accounts while keeping cash and slots separate', () => {
  const { simulateHousehold } = loadSimulator();
  assert.equal(typeof simulateHousehold, 'function');

  const result = simulateHousehold(14, 12, 'same', '1', 13, 0, 3);
  assert.equal(result.capacity, 9);
  assert.equal(result.accounts.length, 3);
  assert.equal(JSON.stringify(result.accounts.map(account => account.cycles.map(cycle => cycle.start))), JSON.stringify([[0, 12], [0, 12], [0, 12]]));
  assert.equal(JSON.stringify(result.accounts.map(account => account.cash)), JSON.stringify([0, 0, 0]));
});

test('household calendar discloses per-account Day-12 funding, hold status, and its displayed scope', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(html, /per selected eligible-adult account/i);
  assert.match(html, /household-wide external funding/i);
  assert.match(html, /first 12 funding days/i);
  assert.match(html, /prior earnings held until Day 19/i);
});

test('bootstrap expansion starts separate Accounts 2 and 3 only after Account 1 funds become available', () => {
  const { simulateExpansion } = loadSimulator();
  assert.equal(typeof simulateExpansion, 'function');

  const result = simulateExpansion(14, 38, 'same', '1', 3);
  assert.equal(JSON.stringify(result.transfers.map(transfer => [transfer.day, transfer.from, transfer.to, transfer.amount])), JSON.stringify([[19, 1, 2, 14], [38, 2, 3, 14]]));
  assert.equal(JSON.stringify(result.accounts.map(account => account.cycles.map(cycle => cycle.start))), JSON.stringify([[0], [19], [38]]));
  assert.ok(result.transfers.every(transfer => transfer.day >= 19));
  assert.match(fs.readFileSync('index.html', 'utf8'), /mode==='bootstrap'\)\{const expansion/);
});

test('fast seed recovery protects only available surplus and never counts held Day-12 earnings', () => {
  const { simulate } = loadSimulator();
  const result = simulate(14, 76, 'same', '1', 0, 0, 'fast');
  assert.equal(result.protected, 14);
  assert.equal(result.recoveryDay, 76);
  assert.equal(result.seedTarget, 14);
});
