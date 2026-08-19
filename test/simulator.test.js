const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadSimulator() {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const core = script
    .slice(script.indexOf('const levels='), script.indexOf('function render()'))
    .replace(/const sel=[\s\S]*?newLevelSel\.value='1';\n/, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${core}; globalThis.__simulate = simulate; globalThis.__simulateHousehold = typeof simulateHousehold === 'undefined' ? undefined : simulateHousehold; globalThis.__simulateExpansion = typeof simulateExpansion === 'undefined' ? undefined : simulateExpansion; globalThis.__planWithdrawals = typeof planWithdrawals === 'undefined' ? undefined : planWithdrawals; globalThis.__parseWithdrawalRequests = typeof parseWithdrawalRequests === 'undefined' ? undefined : parseWithdrawalRequests; globalThis.__formatPlanDate = typeof formatPlanDate === 'undefined' ? undefined : formatPlanDate; globalThis.__dateToDay = typeof dateToDay === 'undefined' ? undefined : dateToDay; globalThis.__parseCalendarWithdrawalRequests = typeof parseCalendarWithdrawalRequests === 'undefined' ? undefined : parseCalendarWithdrawalRequests; globalThis.__planPercentWithdrawals = typeof planPercentWithdrawals === 'undefined' ? undefined : planPercentWithdrawals; globalThis.__planRecoverThenPercentWithdrawals = typeof planRecoverThenPercentWithdrawals === 'undefined' ? undefined : planRecoverThenPercentWithdrawals;`, context);
  return { simulate: context.__simulate, simulateHousehold: context.__simulateHousehold, simulateExpansion: context.__simulateExpansion, planWithdrawals: context.__planWithdrawals, parseWithdrawalRequests: context.__parseWithdrawalRequests, formatPlanDate: context.__formatPlanDate, dateToDay: context.__dateToDay, parseCalendarWithdrawalRequests: context.__parseCalendarWithdrawalRequests, planPercentWithdrawals: context.__planPercentWithdrawals, planRecoverThenPercentWithdrawals: context.__planRecoverThenPercentWithdrawals };
}

function syntheticPath(cash, days, committed = 0) {
  const path = [];
  for (let day = 0; day <= days; day += 1) path.push({ day, cash, committed });
  return path;
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

test('existing-campaigns onboarding seeds the selected level/count as already-paid Day-0 campaigns', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1000, 0, 'same', '1', 0, 0, 'growth', { level: 2, count: 3 });

  const seeded = result.cycles.filter(cycle => cycle.start === 0);
  assert.equal(seeded.length, 3);
  assert.ok(seeded.every(cycle => cycle.level === 2), 'every seeded cycle uses the selected level');
  assert.ok(seeded.every(cycle => cycle.cost === 0), 'existing campaigns are already paid, so they cost nothing in this plan');
  assert.ok(seeded.every(cycle => cycle.clickDone === 12 && cycle.ready === 19), 'existing campaigns follow the normal Day 12 / Day 19 milestones from plan Day 0');
});

test('existing campaigns occupy active capacity, blocking new purchases from the separate starting cash when slots are full', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1000, 0, 'same', '1', 0, 0, 'growth', { level: 1, count: 3 });

  assert.equal(result.cycles.length, 3, 'no room remains for a new purchase once existing campaigns fill all 3 slots');
  assert.equal(result.cash, 1000, 'starting available balance is untouched cash outside the existing campaigns');
});

test('existing campaigns respect the active de-risk slot cap, not just the raw 3-campaign limit', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1000, 0, 'same', '1', 0, 0, 'fast', { level: 1, count: 1 });

  assert.equal(result.cycles.length, 1, 'the fast de-risk setting allows only 1 active slot, already occupied by the existing campaign');
  assert.equal(result.cash + result.protected, 1000, 'no new purchase happens even though cash is available, because the single slot is occupied (unused cash is set aside, not spent)');
});

test('existing campaigns release their published expected earnings on Day 19, exactly like a freshly bought campaign', () => {
  const { simulate } = loadSimulator();
  // same='7' with no starting cash means nothing is affordable before or after the Day-19 release,
  // isolating the release itself from same-day reinvestment.
  const result = simulate(0, 19, 'same', '7', 0, 0, 'growth', { level: 2, count: 1 });

  assert.equal(result.cash, 101.70, 'the Level 2 published expected earnings (101.70) release on Day 19');
  assert.equal(result.pending, 0, 'nothing remains pending once the Day-19 release has happened');
  assert.ok(result.log.some(entry => entry.day === 19 && entry.kind === 'release'), 'a Day-19 release log entry is recorded for the existing campaign');
});

test('starting available balance stays separate cash outside existing campaigns and can still fund a new purchase when a slot is free', () => {
  const { simulate } = loadSimulator();
  const result = simulate(90, 0, 'same', '1', 0, 0, 'growth', { level: 1, count: 2 });

  assert.equal(result.cycles.filter(cycle => cycle.cost === 0).length, 2, 'the 2 existing campaigns are seeded at zero cost');
  const bought = result.cycles.filter(cycle => cycle.cost > 0);
  assert.equal(bought.length, 1, 'the one remaining active slot can still be filled from the separate starting cash');
  assert.equal(result.cash, 90 - bought[0].cost, 'only the newly purchased campaign draws down the separate starting cash');
});

test('new-campaigns onboarding seeds a single Level 1 campaign as a Day-0 purchase including its one-time activation fee', () => {
  const { simulate } = loadSimulator();
  const result = simulate(0, 0, 'same', '1', 0, 0, 'growth', null, { level: 1, count: 1 });

  const seeded = result.cycles.filter(cycle => cycle.start === 0);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].level, 1);
  assert.equal(seeded[0].first, true, 'the first campaign at a newly-activated level always includes the activation fee');
  assert.equal(seeded[0].cost, 14, 'Level 1 outlay is the 13 campaign cost plus the 1 one-time activation fee');
  assert.equal(seeded[0].clickDone, 12);
  assert.equal(seeded[0].ready, 19);
});

test('new-campaigns onboarding charges the one-time activation fee only once across multiple same-level campaigns (Level 5, 2 campaigns)', () => {
  const { simulate } = loadSimulator();
  const result = simulate(0, 0, 'same', '1', 0, 0, 'growth', null, { level: 5, count: 2 });

  const seeded = result.cycles.filter(cycle => cycle.start === 0);
  assert.equal(seeded.length, 2);
  const costs = seeded.map(cycle => cycle.cost).sort((a, b) => b - a);
  assert.equal(JSON.stringify(costs), JSON.stringify([660, 600]), 'only the first Level 5 campaign includes the 60 activation fee (600+60), the second is 600 campaign cost only');
  assert.equal(seeded.filter(cycle => cycle.first).length, 1, 'exactly one seeded campaign carries the activation-fee flag');
  assert.equal(costs.reduce((a, b) => a + b, 0), 1260, 'total required starting outlay for L5 x2 is 1260 (600*2 + 60 activation fee once)');
});

test('new campaigns are not already paid: their real cost is tracked, unlike the zero-cost existing-campaigns route', () => {
  const { simulate } = loadSimulator();
  const result = simulate(0, 0, 'same', '1', 0, 0, 'growth', null, { level: 1, count: 1 });
  assert.ok(result.cycles[0].cost > 0, 'new campaigns are newly purchased, so cost must be non-zero unlike existing campaigns');
});

test('new campaigns occupy active capacity, blocking an additional purchase from the separate starting cash when slots are full', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1000, 0, 'same', '1', 0, 0, 'growth', null, { level: 1, count: 3 });

  assert.equal(result.cycles.length, 3, 'no room remains for an extra purchase once the new campaigns fill all 3 slots');
  assert.equal(result.cash, 1000, 'the separate starting available balance stays untouched—the outlay is calculated and applied automatically, not drawn from this cash');
});

test('new campaigns respect the active de-risk slot cap, not just the raw 3-campaign limit', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1000, 0, 'same', '1', 0, 0, 'fast', null, { level: 1, count: 1 });

  assert.equal(result.cycles.length, 1, 'the fast de-risk setting allows only 1 active slot, already occupied by the new campaign');
  assert.equal(result.cash + result.protected, 1000, 'no organic purchase happens even though cash is available, because the single slot is occupied (unused cash is set aside, not spent)');
});

test('new campaigns release their published expected earnings on Day 19, exactly like a freshly bought campaign', () => {
  const { simulate } = loadSimulator();
  const result = simulate(0, 19, 'same', '7', 0, 0, 'growth', null, { level: 2, count: 1 });

  assert.equal(result.cash, 101.70, 'the Level 2 published expected earnings (101.70) release on Day 19');
  assert.equal(result.pending, 0, 'nothing remains pending once the Day-19 release has happened');
  assert.ok(result.log.some(entry => entry.day === 19 && entry.kind === 'release'), 'a Day-19 release log entry is recorded for the new campaign');
});

test('the separate starting cash can still fund one more organic purchase once new-campaign slots leave room', () => {
  const { simulate } = loadSimulator();
  const result = simulate(90, 0, 'same', '1', 0, 0, 'growth', null, { level: 1, count: 2 });

  const seeded = result.cycles.filter(cycle => cycle.newPurchase);
  assert.equal(seeded.length, 2, 'the 2 new campaigns are seeded as real Day-0 purchases');
  const bought = result.cycles.filter(cycle => !cycle.newPurchase);
  assert.equal(bought.length, 1, 'the one remaining active slot can still be filled organically from the separate starting cash');
  assert.equal(bought[0].cost, 13, 'Level 1 is already activated by the seeded campaigns, so the organic purchase pays only the campaign cost, no second activation fee');
  assert.equal(result.cash, 90 - bought[0].cost, 'only the organically-purchased campaign draws down the separate starting cash');
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

test('bootstrap expansion is wired into the rendered bootstrap view', () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /mode==='bootstrap'\)\{const expansion/);
});

test('bootstrap defers Pay-It-Forward while Account 1 can still fund its own replacement campaigns', () => {
  const { simulateExpansion } = loadSimulator();
  assert.equal(typeof simulateExpansion, 'function');

  // Account 1 releases 17.17 on Day 19 but immediately reinvests all but 4.17 into its
  // own second campaign (cost 13) — that leftover is not genuine surplus, so no PIF fires
  // even though the old (buggy) engine would have donated 14 of it on Day 19.
  const result = simulateExpansion(14, 38, 'same', '1', 3);
  assert.equal(JSON.stringify(result.transfers), '[]');
  assert.equal(JSON.stringify(result.accounts.map(account => account.cycles.map(cycle => cycle.start))), JSON.stringify([[0, 19, 38], [], []]));
  assert.ok(result.accounts.every(account => account.cash >= 0), 'no account should ever go cash-negative');
});

test('bootstrap sends a Pay-It-Forward transfer only once the donor has maximized its own active-campaign capacity', () => {
  const { simulateExpansion } = loadSimulator();
  const result = simulateExpansion(14, 200, 'same', '1', 3);

  assert.equal(JSON.stringify(result.transfers.map(transfer => [transfer.day, transfer.from, transfer.to, transfer.amount])), JSON.stringify([[133, 1, 2, 14], [152, 1, 3, 14]]));
  assert.ok(result.accounts.every(account => account.cash >= 0), 'no account should ever go cash-negative');

  const activeSlotsAt = (cycles, day) => cycles.filter(cycle => cycle.start <= day && cycle.start + 12 > day).length;
  for (const transfer of result.transfers) {
    const donor = result.accounts[transfer.from - 1];
    assert.equal(activeSlotsAt(donor.cycles, transfer.day), 3, `donor Account ${transfer.from} must hold all 3 active slots before donating on Day ${transfer.day}`);
  }
});

test('bootstrap honors Day-12 external funds, which can create genuine surplus and accelerate a Pay-It-Forward transfer', () => {
  const { simulateExpansion } = loadSimulator();
  const result = simulateExpansion(14, 60, 'same', '1', 2, 50, 0);

  assert.equal(JSON.stringify(result.transfers.map(transfer => [transfer.day, transfer.from, transfer.to, transfer.amount])), JSON.stringify([[19, 1, 2, 14]]));
  assert.equal(result.accounts[1].cycles[0].start, 19, 'Account 2 deploys its Pay-It-Forward seed the same day it is received');
});

test('bootstrap honors the seed-capital recovery filter, restricting Account 1 to one slot until its own seed is protected', () => {
  const { simulateExpansion } = loadSimulator();
  const result = simulateExpansion(14, 200, 'same', '1', 2, 0, 0, 'fast');

  assert.equal(result.accounts[0].protectedCash, 14);
  assert.equal(result.accounts[0].seedTarget, 14);
  assert.equal(result.accounts[0].recoveryDay, 76);
  assert.equal(JSON.stringify(result.transfers.map(transfer => [transfer.day, transfer.from, transfer.to, transfer.amount])), JSON.stringify([[190, 1, 2, 14]]));
});

test('fast seed recovery protects only available surplus and never counts held Day-12 earnings', () => {
  const { simulate } = loadSimulator();
  const result = simulate(14, 76, 'same', '1', 0, 0, 'fast');
  assert.equal(result.protected, 14);
  assert.equal(result.recoveryDay, 76);
  assert.equal(result.seedTarget, 14);
});

test('portfolio strategy considers activation-aware mixes instead of greedy single-level purchases', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1320, 11, 'portfolio', '1', 0, 0);
  assert.equal(JSON.stringify(result.cycles.map(cycle => cycle.level).sort((a,b)=>a-b)), JSON.stringify([1, 5, 5]));
  assert.equal(result.cash, 46);
  assert.equal(result.pending, 1572.37);
});

test('portfolio strategy fills both remaining slots with Level 5 when that mix beats the alternatives', () => {
  const { simulate } = loadSimulator();
  const result = simulate(1260, 11, 'portfolio', '1', 0, 0);
  assert.equal(JSON.stringify(result.cycles.map(cycle => cycle.level).sort((a, b) => a - b)), JSON.stringify([5, 5]));
  assert.equal(result.cash, 0);
  assert.equal(result.pending, 1555.2);
});

test('portfolio strategy selects Level 6 campaigns once they become the better legal mix', () => {
  const { simulate } = loadSimulator();
  const result = simulate(2520, 11, 'portfolio', '1', 0, 0);
  assert.equal(JSON.stringify(result.cycles.map(cycle => cycle.level).sort((a, b) => a - b)), JSON.stringify([6, 6]));
  assert.equal(result.cash, 0);
  assert.equal(result.pending, 3110.4);
});

test('withdrawal planner rejects requests below the USDT 10 minimum', () => {
  const { simulate, planWithdrawals } = loadSimulator();
  assert.equal(typeof planWithdrawals, 'function');
  const result = simulate(42, 30, 'same', '1', 0, 0);

  const [withdrawal] = planWithdrawals(result.path, [{ day: 19, amount: 5 }]);
  assert.equal(withdrawal.status, 'rejected');
  assert.match(withdrawal.reason, /10.00 USDT minimum/);
  assert.equal(withdrawal.feeCents, 0);
  assert.equal(withdrawal.netCents, 0);
});

test('withdrawal planner distinguishes requested, held (pending), and net-received amounts and applies the 10% fee', () => {
  const { simulate, planWithdrawals } = loadSimulator();
  const result = simulate(42, 30, 'same', '1', 0, 0);

  const [withdrawal] = planWithdrawals(result.path, [{ day: 19, amount: 10 }]);
  assert.equal(withdrawal.status, 'accepted');
  assert.equal(withdrawal.requestedCents, 1000);
  assert.equal(withdrawal.pendingCents, 5151);
  assert.equal(withdrawal.feeCents, 100);
  assert.equal(withdrawal.netCents, 900);
});

test('withdrawal planner never lets a request draw on held (pending) campaign earnings', () => {
  const { simulate, planWithdrawals } = loadSimulator();
  const result = simulate(42, 30, 'same', '1', 0, 0);

  // Day 5: only 2.00 USDT is available; 51.51 USDT is still held until Day 19.
  const [withdrawal] = planWithdrawals(result.path, [{ day: 5, amount: 20 }]);
  assert.equal(withdrawal.status, 'rejected');
  assert.match(withdrawal.reason, /held campaign earnings cannot be withdrawn/);
  assert.equal(withdrawal.pendingCents, 5151);
  assert.equal(withdrawal.availableCents, 200);
});

test('withdrawal planner enforces one accepted request per rolling 7-day window', () => {
  const { simulate, planWithdrawals } = loadSimulator();
  const result = simulate(5000, 40, 'same', '7', 0, 0);

  const [first, second, third] = planWithdrawals(result.path, [
    { day: 19, amount: 100 },
    { day: 22, amount: 100 },
    { day: 26, amount: 100 },
  ]);
  assert.equal(first.status, 'accepted');
  assert.equal(second.status, 'rejected');
  assert.match(second.reason, /weekly withdrawal request limit/);
  assert.equal(third.status, 'accepted', 'a request exactly 7 days after the prior accepted one is outside the window');
});

test('withdrawal planner parses day:amount pairs and silently drops invalid or non-positive entries', () => {
  const { parseWithdrawalRequests } = loadSimulator();
  const requests = parseWithdrawalRequests('30:50, 5:x, bogus, 10:0, 12:25.5');
  assert.equal(JSON.stringify(requests), JSON.stringify([{ day: 30, amount: 50 }, { day: 12, amount: 25.5 }]));
  assert.equal(JSON.stringify(parseWithdrawalRequests('')), '[]');
  assert.equal(JSON.stringify(parseWithdrawalRequests(undefined)), '[]');
});

test('calendar dates map Day 0, Day 12, and Day 19 without timezone drift', () => {
  const { formatPlanDate } = loadSimulator();
  assert.equal(formatPlanDate('2026-08-17', 0), 'Aug 17, 2026');
  assert.equal(formatPlanDate('2026-08-17', 12), 'Aug 29, 2026');
  assert.equal(formatPlanDate('2026-08-17', 19), 'Sep 5, 2026');
});

test('simulate stays well-defined for zero or negative starting balances instead of throwing', () => {
  const { simulate } = loadSimulator();
  const zero = simulate(0, 10, 'same', '1', 0, 0);
  assert.equal(zero.cycles.length, 0);
  assert.equal(zero.cash, 0);

  const negative = simulate(-50, 10, 'same', '1', 0, 0);
  assert.equal(negative.cycles.length, 0);
  assert.equal(negative.cash, -50);
});

test('dateToDay maps calendar dates back to day offsets without timezone drift, and rejects dates before start', () => {
  const { dateToDay } = loadSimulator();
  assert.equal(typeof dateToDay, 'function');
  assert.equal(dateToDay('2026-08-17', '2026-08-17'), 0);
  assert.equal(dateToDay('2026-08-17', '2026-08-29'), 12);
  assert.equal(dateToDay('2026-08-17', '2026-09-05'), 19);
  assert.equal(dateToDay('2026-08-17', '2026-08-01'), null, 'a date before the start date is invalid');
  assert.equal(dateToDay('2026-08-17', 'not-a-date'), null);
  assert.equal(dateToDay('not-a-date', '2026-08-17'), null);
  assert.equal(dateToDay('', '2026-08-17'), null);
});

test('parseCalendarWithdrawalRequests converts date:amount pairs to day:amount and silently drops invalid entries', () => {
  const { parseCalendarWithdrawalRequests } = loadSimulator();
  assert.equal(typeof parseCalendarWithdrawalRequests, 'function');
  const requests = parseCalendarWithdrawalRequests('2026-08-17', '2026-09-15:50, bogus, 2026-08-01:20, 2026-09-20:0, 2026-09-25:25.5');
  assert.equal(JSON.stringify(requests), JSON.stringify([{ day: 29, amount: 50 }, { day: 39, amount: 25.5 }]));
  assert.equal(JSON.stringify(parseCalendarWithdrawalRequests('2026-08-17', '')), '[]');
  assert.equal(JSON.stringify(parseCalendarWithdrawalRequests('2026-08-17', undefined)), '[]');
});

test('planPercentWithdrawals withdraws a percentage of available (non-held) balance on a fixed interval', () => {
  const { planPercentWithdrawals } = loadSimulator();
  assert.equal(typeof planPercentWithdrawals, 'function');
  const path = syntheticPath(1000, 30);

  const weekly = planPercentWithdrawals(path, 10, 7);
  assert.equal(JSON.stringify(weekly.map(w => w.day)), JSON.stringify([7, 14, 21, 28]));
  assert.equal(JSON.stringify(weekly.map(w => w.status)), JSON.stringify(['accepted', 'accepted', 'accepted', 'accepted']));
  assert.equal(JSON.stringify(weekly.map(w => w.availableCents)), JSON.stringify([100000, 90000, 81000, 72900]));
  assert.equal(JSON.stringify(weekly.map(w => w.requestedCents)), JSON.stringify([10000, 9000, 8100, 7290]));
  assert.equal(JSON.stringify(weekly.map(w => w.feeCents)), JSON.stringify([1000, 900, 810, 729]));
  assert.equal(JSON.stringify(weekly.map(w => w.netCents)), JSON.stringify([9000, 8100, 7290, 6561]));

  const biweekly = planPercentWithdrawals(path, 10, 14);
  assert.equal(JSON.stringify(biweekly.map(w => w.day)), JSON.stringify([14, 28]));
  assert.equal(JSON.stringify(biweekly.map(w => w.requestedCents)), JSON.stringify([10000, 9000]));
});

test('planPercentWithdrawals rejects a scheduled request that would fall below the USDT 10 minimum', () => {
  const { planPercentWithdrawals } = loadSimulator();
  const path = syntheticPath(50, 30);
  const [withdrawal] = planPercentWithdrawals(path, 5, 7);
  assert.equal(withdrawal.status, 'rejected');
  assert.match(withdrawal.reason, /10.00 USDT minimum/);
});

test('planPercentWithdrawals never draws on held (pending/committed) campaign earnings', () => {
  const { planPercentWithdrawals } = loadSimulator();
  const path = syntheticPath(20, 30, 5000);
  const [withdrawal] = planPercentWithdrawals(path, 100, 7);
  assert.equal(withdrawal.status, 'accepted');
  assert.equal(withdrawal.requestedCents, 2000);
  assert.equal(withdrawal.pendingCents, 500000);
});

test('planRecoverThenPercentWithdrawals recovers starting cash first, then switches to scheduled percentage withdrawals', () => {
  const { planRecoverThenPercentWithdrawals } = loadSimulator();
  assert.equal(typeof planRecoverThenPercentWithdrawals, 'function');
  const path = syntheticPath(1000, 30);

  const plan = planRecoverThenPercentWithdrawals(path, 250, 10, 7);
  assert.equal(JSON.stringify(plan.map(w => w.day)), JSON.stringify([7, 14, 21, 28]));
  assert.equal(plan[0].requestedCents, 25000, 'first request recovers exactly the starting cash in one shot since funds are available');
  assert.equal(plan[0].status, 'accepted');
  assert.equal(plan[1].requestedCents, 7500, '10% of the 75000 cents remaining available after recovery');
  assert.equal(plan[2].requestedCents, 6750);
  assert.equal(plan[3].requestedCents, 6075);
});

test('planRecoverThenPercentWithdrawals closes out a sub-minimum recovery remainder with a single USDT 10 request instead of stalling forever', () => {
  const { planRecoverThenPercentWithdrawals } = loadSimulator();
  const path = syntheticPath(1000, 14);

  const plan = planRecoverThenPercentWithdrawals(path, 5, 10, 7);
  assert.equal(plan[0].requestedCents, 1000, 'remaining recovery (500 cents) is below the minimum, so it rounds up to the USDT 10 floor');
  assert.equal(plan[0].status, 'accepted');
  assert.equal(plan[1].requestedCents, 9900, '10% of the 99000 cents available after recovery closes out');
});

test('the withdrawal planner UI offers explicit strategy choices instead of a raw day:amount field', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.doesNotMatch(html, /Withdrawal requests \(day:amount USDT, comma-separated\)/, 'raw day:amount input should be replaced');
  assert.match(html, /id="withdrawStrategy"/);
  assert.match(html, /<option value="none">/);
  assert.match(html, /<option value="calendar">/);
  assert.match(html, /<option value="weekly">/);
  assert.match(html, /<option value="biweekly">/);
  assert.match(html, /<option value="recover">/);
  assert.match(html, /id="withdrawCalendarRequests"/);
  assert.match(html, /id="withdrawPercent"/);
});
