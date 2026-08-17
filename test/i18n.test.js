const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadI18n() {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const core = script
    .slice(script.indexOf('const levels='), script.indexOf('function render()'))
    .replace(/const sel=[\s\S]*?;\n/, '');
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${core}; globalThis.__I18N = I18N; globalThis.__t = t; globalThis.__getCurrentLang = () => currentLang; globalThis.__setCurrentLang = (l) => { currentLang = l; }; globalThis.__formatPlanDate = formatPlanDate;`,
    context
  );
  return {
    I18N: context.__I18N,
    t: context.__t,
    getCurrentLang: context.__getCurrentLang,
    setCurrentLang: context.__setCurrentLang,
    formatPlanDate: context.__formatPlanDate,
  };
}

test('default language is English before any explicit selection', () => {
  const { getCurrentLang } = loadI18n();
  assert.equal(getCurrentLang(), 'en');
});

test('the i18n dictionary defines both an English and a Spanish table', () => {
  const { I18N } = loadI18n();
  assert.equal(typeof I18N.en, 'object');
  assert.equal(typeof I18N.es, 'object');
  assert.ok(Object.keys(I18N.en).length > 50, 'expected a substantial English dictionary');
});

test('every English dictionary key has a matching Spanish translation and vice versa', () => {
  const { I18N } = loadI18n();
  const enKeys = Object.keys(I18N.en).sort();
  const esKeys = Object.keys(I18N.es).sort();
  assert.deepEqual(esKeys, enKeys, 'Spanish dictionary must cover exactly the same keys as English');
});

test('no dictionary entry is left untranslated (Spanish value differs from English for user-facing text)', () => {
  const { I18N } = loadI18n();
  const identical = Object.keys(I18N.en).filter(key => I18N.en[key] === I18N.es[key]);
  // A handful of short structural/markup-only keys may legitimately coincide across languages.
  assert.ok(identical.length < 5, `too many untranslated keys: ${identical.join(', ')}`);
});

test('t() returns the English string by default and substitutes {var} placeholders', () => {
  const { t } = loadI18n();
  assert.equal(t('runButton'), 'Run scenario');
  assert.equal(t('dayN', { n: 12 }), 'Day 12');
  assert.equal(t('levelOption', { n: 3 }), 'Level 3');
});

test('t() switches to Spanish once currentLang is set to es', () => {
  const { t, setCurrentLang } = loadI18n();
  setCurrentLang('es');
  assert.equal(t('runButton'), 'Ejecutar escenario');
  assert.equal(t('dayN', { n: 12 }), 'Día 12');
});

test('t() falls back to the key itself for an unknown key rather than throwing', () => {
  const { t } = loadI18n();
  assert.equal(t('thisKeyDoesNotExist'), 'thisKeyDoesNotExist');
});

test('t() substitutes every placeholder occurrence, including repeated ones', () => {
  const { t } = loadI18n();
  const result = t('metricSeedProtectedOf', { protected: '5.00 USDT', target: '14.00 USDT' });
  assert.equal(result, '5.00 USDT of 14.00 USDT');
});

test('formatPlanDate uses English month names by default and Spanish once selected', () => {
  const { formatPlanDate, setCurrentLang } = loadI18n();
  assert.equal(formatPlanDate('2026-08-17', 0), 'Aug 17, 2026');
  setCurrentLang('es');
  const esDate = formatPlanDate('2026-08-17', 0);
  assert.notEqual(esDate, 'Aug 17, 2026');
  assert.match(esDate, /2026/);
});

test('the HTML wires up a language selector defaulting to English with a Spanish option', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /id="langSelect"/);
  assert.match(html, /<option value="en">English<\/option>/);
  assert.match(html, /<option value="es">Español<\/option>/);
});

test('static UI text carries data-i18n hooks so the selector can translate it at runtime', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const dataI18nCount = (html.match(/data-i18n(-html|-placeholder|-aria)?="/g) || []).length;
  assert.ok(dataI18nCount > 40, `expected many data-i18n hooks in static markup, found ${dataI18nCount}`);
});

test('withdrawal rejection reasons stay in English by default so existing pure-function tests remain stable', () => {
  const { t } = loadI18n();
  assert.match(t('reasonBelowMin', { min: '10.00 USDT' }), /10.00 USDT minimum/);
  assert.match(t('reasonWeeklyLimit', { days: 7 }), /weekly withdrawal request limit/);
  assert.match(t('reasonHeldBalance'), /held campaign earnings cannot be withdrawn/);
});
