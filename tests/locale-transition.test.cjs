'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  createLocaleTransitionCoordinator,
  localeTransitionAllowsDirectionReload
} = require('../src/services/locale-transition');

test('a matching locale transition blocks direction work until preparation completes', async () => {
  const coordinator = createLocaleTransitionCoordinator({ timeoutMs: 100 });
  const transition = coordinator.begin('ar');
  let released = false;
  const waiting = coordinator.waitFor('ar').then((result) => {
    released = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(released, false);
  assert.equal(coordinator.complete(transition, { status: 'reminder-ready' }), true);

  const result = await waiting;
  assert.equal(result.status, 'reminder-ready');
  assert.equal(result.matched, true);
  assert.equal(result.current, true);
});

test('a newer locale generation releases and invalidates stale direction work', async () => {
  const coordinator = createLocaleTransitionCoordinator({ timeoutMs: 100 });
  const arabic = coordinator.begin('ar');
  const staleWait = coordinator.waitFor('ar');
  const english = coordinator.begin('en');

  const stale = await staleWait;
  assert.equal(stale.status, 'superseded');
  assert.equal(stale.current, false);
  assert.equal(coordinator.isCurrent(arabic), false);
  assert.equal(coordinator.complete(arabic), false);

  const currentWait = coordinator.waitFor('en');
  assert.equal(coordinator.complete(english), true);
  const current = await currentWait;
  assert.equal(current.status, 'ready');
  assert.equal(current.current, true);
});

test('direction work follows the newest generation when the target locale is unchanged', async () => {
  const coordinator = createLocaleTransitionCoordinator({ timeoutMs: 100 });
  const first = coordinator.begin('ar');
  const waiting = coordinator.waitForCurrent('ar');
  const second = coordinator.begin('ar');

  assert.equal(coordinator.complete(first), false);
  assert.equal(coordinator.complete(second, { status: 'latest-ready' }), true);
  const result = await waiting;
  assert.equal(result.status, 'latest-ready');
  assert.equal(result.current, true);
  assert.equal(result.generation, second.generation);
});

test('an abandoned locale preparation times out instead of deadlocking reload work', async () => {
  const coordinator = createLocaleTransitionCoordinator({ timeoutMs: 5 });
  const transition = coordinator.begin('he');
  const result = await coordinator.waitFor('he');

  assert.equal(result.status, 'timeout');
  assert.equal(result.error?.code, 'TIMEOUT');
  assert.equal(result.current, true);
  assert.equal(localeTransitionAllowsDirectionReload(result), false);
  assert.equal(coordinator.complete(transition, { status: 'late-completion' }), true);
});

test('only current, safely prepared locale generations may trigger a direction reload', () => {
  assert.equal(localeTransitionAllowsDirectionReload({ matched: false, status: 'uncoordinated' }), true);
  assert.equal(localeTransitionAllowsDirectionReload({ matched: true, current: true, status: 'ready' }), true);
  assert.equal(localeTransitionAllowsDirectionReload({ matched: true, current: false, status: 'ready' }), false);
  assert.equal(localeTransitionAllowsDirectionReload({ matched: true, current: true, status: 'superseded' }), false);
  assert.equal(localeTransitionAllowsDirectionReload({ matched: true, current: true, status: 'reminder-superseded' }), false);
  assert.equal(localeTransitionAllowsDirectionReload({ matched: true, current: true, status: 'reminder-cleanup-incomplete' }), false);
});

test('I18nProvider wires persistence and reminder preparation ahead of native reload', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/context/I18nContext.js'),
    'utf8'
  );
  const directionEffect = source.slice(
    source.indexOf('const applyDirection'),
    source.indexOf('const t = useCallback')
  );
  const reminderPreparation = source.slice(
    source.indexOf('const prepareLocalizedReminder'),
    source.indexOf('useEffect(() =>')
  );
  const languageChange = source.slice(
    source.indexOf('const setLanguage = useCallback'),
    source.indexOf('const value = useMemo')
  );

  const waitsForPreparation = directionEffect.indexOf('await localeTransitionRef.current.waitForCurrent(locale)');
  const forcesDirection = directionEffect.indexOf('I18nManager.forceRTL(isRTL)');
  const persistsDirection = directionEffect.indexOf('await persistRecordedLocaleDirection(desiredDirection)');
  const reloads = directionEffect.indexOf('await reloadAppAsync');
  assert.ok(waitsForPreparation >= 0 && waitsForPreparation < forcesDirection);
  assert.ok(forcesDirection < persistsDirection);
  assert.ok(persistsDirection < reloads);
  assert.match(directionEffect, /if \(!active \|\| desiredLocaleRef\.current !== locale \|\| !needsReload\) return/);
  assert.match(directionEffect, /clearRecordedLocaleDirection\(\)/);

  const beginsGate = languageChange.indexOf('coordinator.begin(targetLocale)');
  const publishesLanguage = languageChange.indexOf('await updateSettings({ language })');
  const refreshesReminder = languageChange.indexOf('await prepareLocalizedReminder(targetLocale');
  const completesGate = languageChange.lastIndexOf('coordinator.complete(transition, completion)');
  assert.ok(beginsGate >= 0 && beginsGate < publishesLanguage);
  assert.ok(publishesLanguage < refreshesReminder);
  assert.ok(refreshesReminder < completesGate);
  assert.ok(
    reminderPreparation.indexOf('setI18nLocale(targetLocale)')
      < reminderPreparation.indexOf('refreshSafetyNotificationChannel(targetLocale)')
  );
  assert.ok(
    reminderPreparation.indexOf('refreshSafetyNotificationChannel(targetLocale)')
      < reminderPreparation.indexOf('if (!enabled) return')
  );
  assert.match(
    reminderPreparation,
    /Could not refresh the localized notification channel/
  );
  assert.match(reminderPreparation, /setCapybearReminderEnabled\(true, \{ locale: targetLocale \}\)/);
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*setI18nLocale\(locale\);\s*\}, \[locale\]\)/);
  assert.match(directionEffect, /if \(!preparation\.matched\)[\s\S]*await prepareLocalizedReminder\(locale/);
  assert.match(directionEffect, /if \(preparation\.pendingLocale\) return/);
});
