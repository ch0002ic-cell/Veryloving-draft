'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = (relativePath) => readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('medical profile and medication schedule expose retryable initial-load failures', () => {
  const medicalProfile = source('app/medical-profile.js');
  assert.match(medicalProfile, /const loadProfile = useCallback\(async \(\) =>/);
  assert.match(medicalProfile, /message=\{t\('medicalProfile\.loadFailed'\)\}/);
  assert.match(medicalProfile, /actionLabel=\{t\('common\.retry'\)\}/);
  assert.match(medicalProfile, /onAction=\{loadProfile\}/);
  assert.match(medicalProfile, /loading \? <LoadingState[\s\S]*: loadFailed \? \(/);

  const medication = source('app/medication-reminders.js');
  assert.match(medication, /const loadReminders = useCallback\(async \(\) =>/);
  assert.match(medication, /message=\{t\('medication\.loadFailed'\)\}/);
  assert.match(medication, /onAction=\{loadReminders\}/);
  assert.match(medication, /!busyAction && !loadFailed && !medicationReminders\.length/);
  assert.match(medication, /const mutationInFlightRef = useRef\(false\)/);
  assert.match(medication, /mutationInFlightRef\.current \|\| busyAction\) return/);
  assert.match(medication, /mutationInFlightRef\.current = true/);
  assert.match(medication, /mutationInFlightRef\.current = false/);
});

test('device management uses an actionable dual-device empty state', () => {
  const devices = source('app/device-management.js');
  assert.match(devices, /<EmptyState/);
  assert.match(devices, /title=\{t\('device\.none'\)\}/);
  assert.match(devices, /message=\{t\('device\.subtitle'\)\}/);
  assert.match(devices, /onAction=\{addWearable\}/);
});

test('safety-mode reconciliation and SOS status failures remain visible and retryable', () => {
  const home = source('app/(tabs)/index.js');
  assert.match(home, /const reconcileSafetyMode = useCallback\(async \(\) =>/);
  assert.match(home, /setModeReconciliationFailed\(true\)/);
  assert.match(home, /onAction=\{modeReconciliationFailed && !reconcilingMode \? reconcileSafetyMode : undefined\}/);
  assert.match(home, /<Image accessible=\{false\} source=\{selectedVoice\.avatar\}/);

  const sos = source('app/emergency-sos.js');
  assert.match(sos, /const refreshLastStatus = useCallback\(async \(\) =>/);
  assert.match(sos, /setStatusLoadState\('error'\)/);
  assert.match(sos, /message=\{t\('releaseCritical\.sosUnknown'\)\}/);
  assert.match(sos, /onAction=\{refreshLastStatus\}/);
  assert.match(sos, /<Ionicons\s+accessible=\{false\}/);
  assert.match(sos, /const activationInFlightRef = useRef\(false\)/);
  assert.match(sos, /if \(!mountedRef\.current \|\| activationInFlightRef\.current\) return/);
  assert.match(sos, /activationInFlightRef\.current = true/);
  assert.match(sos, /activationInFlightRef\.current = false/);
  assert.match(sos, /const lifecycleEpochRef = useRef\(0\)/);
  assert.match(sos, /if \(!mountedRef\.current\) return null;[\s\S]*const lifecycleEpoch = lifecycleEpochRef\.current;[\s\S]*setStatusLoadState\('loading'\)/);
  assert.match(sos, /const requestIsCurrent = \(\) => mountedRef\.current[\s\S]*lifecycleEpoch === lifecycleEpochRef\.current[\s\S]*requestId === statusRequestRef\.current/);
  assert.match(sos, /if \(!mountedRef\.current \|\| activationInFlightRef\.current\) return/);
  assert.match(sos, /const operationIsCurrent = \(\) => mountedRef\.current[\s\S]*lifecycleEpoch === lifecycleEpochRef\.current/);
});

test('medication load retries and mutations are same-tick safe and lifecycle fenced', () => {
  const medication = source('app/medication-reminders.js');

  assert.match(medication, /const loadInFlightRef = useRef\(false\)/);
  assert.match(medication, /if \(!mountedRef\.current \|\| loadInFlightRef\.current \|\| mutationInFlightRef\.current\) return/);
  assert.match(medication, /loadInFlightRef\.current = true;[\s\S]*setBusyAction\('load'\)/);
  assert.match(medication, /const requestIsCurrent = \(\) => mountedRef\.current[\s\S]*lifecycleEpoch === lifecycleEpochRef\.current[\s\S]*requestId === loadRequestRef\.current/);
  assert.match(medication, /const mutationEpoch = \+\+mutationEpochRef\.current/);
  assert.match(medication, /if \(!operationIsCurrent\(\)\) return;[\s\S]*setMedicationReference\(''\)/);
  assert.match(medication, /mountedRef\.current = false;[\s\S]*lifecycleEpochRef\.current \+= 1;[\s\S]*mutationEpochRef\.current \+= 1/);
});

test('voice retry and close intent cannot leak across call lifecycles', () => {
  const safetyCall = source('app/safety-call.js');

  assert.match(safetyCall, /const retryMessageFlightRef = useRef\(null\)/);
  assert.match(safetyCall, /if \(!mountedRef\.current \|\| retryMessageFlightRef\.current\) return/);
  assert.match(safetyCall, /retryMessageFlightRef\.current = flight;[\s\S]*setRetryingMessageId\(messageId\)/);
  assert.match(safetyCall, /if \(retryMessageFlightRef\.current === flight\)[\s\S]*if \(mountedRef\.current\) setRetryingMessageId\(null\)/);
  assert.match(safetyCall, /closeAfterCompletionRef\.current = Boolean\(closeAfter\)/);
  assert.match(safetyCall, /callLifecycleEpochRef\.current === lifecycleEpoch/);
  assert.match(safetyCall, /else if \(callLifecycleEpochRef\.current === lifecycleEpoch\) \{[\s\S]*closeAfterCompletionRef\.current = false/);
  assert.match(safetyCall, /const startCall = useCallback\(\(\) => \{[\s\S]*callLifecycleEpochRef\.current \+= 1;[\s\S]*closeAfterCompletionRef\.current = false/);
  assert.match(safetyCall, /onPress=\{startCall\}/);
});

test('the map exposes every paired device as a named accessibility summary', () => {
  const map = source('app/(tabs)/map.js');
  assert.doesNotMatch(map, /devices\.slice\(/);
  assert.match(map, /\{devices\.map\(\(entity\) =>/);
  assert.match(map, /accessibilityLabel=\{`\$\{deviceName\} · \$\{connectionLabel\}`\}/);
  assert.match(map, /accessibilityRole="summary"/);
  assert.match(map, /<Ionicons\s+accessible=\{false\}/);
});

test('robot pairing remains scrollable at accessibility text sizes and hides camera internals', () => {
  const pairing = source('app/robot-pairing.js');
  assert.doesNotMatch(pairing, /<Screen scroll=\{false\}>/);
  assert.match(pairing, /<CameraView\s+accessible=\{false\}/);
  assert.match(pairing, /onMountError=\{handleCameraMountError\}/);
  assert.match(pairing, /cameraFailed \? \(/);
  assert.match(pairing, /cameraFailed \? \([\s\S]*?<View\s+accessible=\{false\}/);
  assert.match(pairing, /setCameraFailed\(false\)/);
  assert.match(pairing, /accessibilityRole="progressbar"/);
});
