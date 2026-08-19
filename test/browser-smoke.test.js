const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

// Smoke-checks the two Quick plan onboarding paths in a real browser.
// By default this loads the local index.html directly (file://). Set
// SMOKE_URL to point it at a deployed URL instead, e.g.:
//   SMOKE_URL=https://rygeneral.github.io/clickbaitpays-compounding-calculator/ node --test test/browser-smoke.test.js
const targetUrl = process.env.SMOKE_URL || `file://${path.resolve(__dirname, '..', 'index.html')}`;

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(targetUrl);
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('quick plan defaults to fresh-start mode with existing-campaign fields hidden and a next-action summary', async () => {
  await withPage(async (page) => {
    await assert.doesNotReject(page.waitForSelector('#run'));
    assert.equal(await page.locator('#startingState').inputValue(), 'fresh');
    assert.equal(await page.locator('#existingFields').isHidden(), true);
    const nextAction = await page.locator('#nextAction').innerText();
    assert.ok(nextAction.trim().length > 0, 'next-action summary should be populated on initial load');
    assert.match(nextAction, /next action/i);
  });
});

test('switching to "I already have campaigns running" reveals level/count fields, explains the assumption, and updates the plan', async () => {
  await withPage(async (page) => {
    await page.selectOption('#startingState', 'existing');
    assert.equal(await page.locator('#existingFields').isVisible(), true);
    await page.selectOption('#existingLevel', '3');
    await page.selectOption('#existingCount', '2');
    await page.locator('#run').click();
    await page.waitForTimeout(50);

    const note = await page.locator('#existingAssumptionNote').innerText();
    assert.match(note, /Day 0/);
    assert.match(note, /Day 19/);
    assert.match(note, /2/);

    const events = await page.locator('#events').innerText();
    assert.match(events, /existing/i, 'the reinvestment schedule should disclose the pre-seeded existing campaigns');

    const nextAction = await page.locator('#nextAction').innerText();
    assert.ok(nextAction.trim().length > 0);
  });
});

test('switching to "I am starting new campaigns" reveals level/count fields and computes the required starting outlay, including the activation fee once', async () => {
  await withPage(async (page) => {
    await page.selectOption('#startingState', 'new');
    assert.equal(await page.locator('#newFields').isVisible(), true);
    await page.selectOption('#newLevel', '5');
    await page.selectOption('#newCount', '2');

    const note = await page.locator('#newOutlayNote').innerText();
    assert.match(note, /1,260\.00/, 'Level 5 x2 outlay is 600*2 + 60 activation fee once = 1260.00');
    assert.match(note, /Day 0/);

    await page.locator('#run').click();
    await page.waitForTimeout(50);

    const events = await page.locator('#events').innerText();
    assert.match(events, /L5/i, 'the reinvestment schedule should disclose the newly purchased Day-0 campaigns');

    const nextAction = await page.locator('#nextAction').innerText();
    assert.ok(nextAction.trim().length > 0);
  });
});

test('new-campaign capacity fills all 3 slots automatically without spending the separately entered starting cash', async () => {
  await withPage(async (page) => {
    await page.selectOption('#startingState', 'new');
    await page.selectOption('#newLevel', '1');
    await page.selectOption('#newCount', '3');
    await page.fill('#cash', '1000');
    await page.locator('#run').click();
    await page.waitForTimeout(50);

    const nextAction = await page.locator('#nextAction').innerText();
    assert.match(nextAction, /3 active campaign/i);
    assert.match(nextAction, /1,000\.00/, 'the separate starting available balance is untouched by the calculated outlay');
  });
});

test('the onboarding UI explains the New-vs-Existing distinction regardless of which route is selected', async () => {
  await withPage(async (page) => {
    const note = await page.locator('#routeDistinctionNote').innerText();
    assert.match(note, /access\/activation fee/i);
    assert.match(note, /already paid/i);
  });
});

test('cash-only fresh start still runs a full scenario end to end', async () => {
  await withPage(async (page) => {
    assert.equal(await page.locator('#startingState').inputValue(), 'fresh');
    await page.fill('#cash', '14');
    await page.locator('#run').click();
    await page.waitForTimeout(50);

    const events = await page.locator('#events').innerText();
    assert.match(events, /Day 0/);
    const metrics = await page.locator('#metrics').innerText();
    assert.ok(metrics.trim().length > 0);
  });
});

test('Advanced options stays collapsed by default but still exposes every previously existing control', async () => {
  await withPage(async (page) => {
    assert.equal(await page.locator('#advancedOptions').getAttribute('open'), null, 'Advanced options must start collapsed');
    for (const id of ['#strategy', '#derisk', '#sameLevel', '#day12Funds', '#repeatFunds', '#households', '#householdMode', '#withdrawStrategy']) {
      assert.equal(await page.locator(id).count(), 1, `${id} must still exist somewhere in the page`);
    }
    await page.locator('#advancedOptions').evaluate((el) => { el.open = true; });
    assert.equal(await page.locator('#strategy').isVisible(), true);
  });
});

test('the language selector switches the Run button and quick-goal labels to Spanish', async () => {
  await withPage(async (page) => {
    await page.selectOption('#langSelect', 'es');
    assert.equal(await page.locator('#run').innerText(), 'Ejecutar escenario');
    const goalText = await page.locator('#quickGoal option', { hasText: 'Crecer' }).count();
    assert.ok(goalText > 0, 'Spanish quick-goal option text should be present');
  });
});
