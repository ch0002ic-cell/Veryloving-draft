'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const documentPath = path.resolve(process.cwd(), 'docs/final-handoff-audit.md');
const document = readFileSync(documentPath, 'utf8');

test('Grace handoff audit covers every feedback theme with an honest disposition', () => {
  const verdict = document.slice(
    document.indexOf('## Executive verdict'),
    document.indexOf('## Evidence and acceptance by feedback item')
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

  assert.match(verdict, /Two objective themes are \*\*COMPLETE\*\*/);
  assert.match(verdict, /three experiential themes are \*\*PARTIAL\*\*/);
  assert.match(verdict, /none are \*\*MISSING\*\*/);
  assert.match(document, /13 total, 2 PASS, 11 BLOCKED — EXTERNAL/);
  assert.match(document, /ready to work directly with that team on future iterations/i);
  assert.match(document, /NO-GO.*production safety use/i);
});

test('Grace handoff audit contains no broken local Markdown links', () => {
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
