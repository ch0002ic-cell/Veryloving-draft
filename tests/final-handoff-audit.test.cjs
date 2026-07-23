'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const documentPath = path.resolve(process.cwd(), 'docs/final-handoff-confirmation.md');
const document = readFileSync(documentPath, 'utf8');

test('Grace handoff confirmation covers every feedback theme with an honest disposition', () => {
  const verdict = document.slice(
    document.indexOf('## 1. Grace feedback confirmation'),
    document.indexOf('## 2. Final verification record')
  );

  for (const feedback of [
    'These are very basic features',
    'Strong engineering background',
    'Product sense',
    'Aesthetic quality',
    'Worked with design system'
  ]) {
    assert.match(verdict, new RegExp(feedback));
  }

  assert.match(verdict, /five feedback themes are now \*\*COMPLETE at source-code level\*\*/);
  assert.doesNotMatch(verdict, /⚠️\s*\*\*PARTIAL/);
  assert.doesNotMatch(verdict, /❌\s*\*\*MISSING/);
  assert.match(verdict, /external\/manual work/i);
  assert.match(document, /13 tracked external dependencies: \*\*2 PASS\*\*.*\*\*11 BLOCKED — EXTERNAL\*\*/);
  assert.match(document, /ready to work directly with Grace's PM\/UX team on future iterations/i);
  assert.match(document, /NO-GO.*production safety use/i);
  assert.doesNotMatch(document, /starts only `ai_angel_auto_dial`/i);
  assert.doesNotMatch(document, /accepts only the server-mapped AI Angel request/i);
});

test('Grace handoff confirmation contains no broken local Markdown links', () => {
  for (const match of document.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:)/.test(href)) continue;
    const relativePath = href.split('#')[0];
    if (!relativePath) continue;
    assert.equal(
      existsSync(path.resolve(path.dirname(documentPath), decodeURIComponent(relativePath))),
      true,
      `Broken local link: ${href}`
    );
  }
});

test('docs has one canonical handoff plus the dated dependency evidence with stable appendix markers', () => {
  const markdownFiles = readdirSync(path.dirname(documentPath))
    .filter((name) => name.endsWith('.md'))
    .sort();
  assert.deepEqual(markdownFiles, [
    'dependency-audit-2026-07-23.md',
    'final-handoff-confirmation.md'
  ]);

  for (const id of [
    'design-system',
    'mobile-polish-qa',
    'demo-script',
    'demo-dashboard',
    'hardware-partner-research',
    'hardware-partner-decision-matrix',
    'manufacturer-api-requirements',
    'external-dependencies-dashboard',
    'integration-timeline',
    'ask-templates',
    'robot-hal-architecture',
    'robot-adapter-integration-guide',
    'ai-native-integration-guide',
    'api-reference-ai-native',
    'troubleshooting-ai-native'
  ]) {
    assert.match(document, new RegExp(`<!-- BEGIN:${id} -->`));
    assert.match(document, new RegExp(`<!-- END:${id} -->`));
  }
});
