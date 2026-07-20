'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const DOCUMENTS = Object.freeze([
  'docs/hardware-partner-decision-matrix.md',
  'docs/manufacturer-api-requirements.md',
  'docs/external-dependencies-dashboard.md',
  'docs/integration-timeline.md',
  'docs/ask-templates.md'
]);

const parseMarkdownRow = (row) => row
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map((cell) => cell.trim());

const firstDay = (cell) => {
  const match = cell.match(/Day (\d+)/);
  assert.ok(match, `schedule cell lacks a Day value: ${cell}`);
  return Number(match[1]);
};

test('Product 2 decision and dependency documents are complete and status-explicit', () => {
  for (const relativePath of DOCUMENTS) {
    const contents = read(relativePath);
    assert.ok(contents.length > 1_000, `${relativePath} must contain a substantive deliverable`);
  }

  const decision = read('docs/hardware-partner-decision-matrix.md');
  const criteria = decision.match(/^\| \d+ \|/gm) ?? [];
  assert.equal(criteria.length, 21, 'decision matrix must retain all 21 weighted criteria');
  const decisionRows = decision.split('\n').filter((row) => /^\| \d+ \|/.test(row));
  const criterionNumbers = decisionRows.map((row) => Number(parseMarkdownRow(row)[0]));
  const weights = decisionRows.map((row) => Number(parseMarkdownRow(row)[2]));
  assert.deepEqual(criterionNumbers, Array.from({ length: 21 }, (_, index) => index + 1));
  assert.ok(weights.every((weight) => Number.isFinite(weight) && weight > 0));
  assert.equal(weights.reduce((total, weight) => total + weight, 0), 100);

  const blockerRows = decision.split('\n').filter((row) => /^\| \*\*B-[A-Z]+\*\* \|/.test(row));
  const blockerIds = new Set(blockerRows.map((row) => parseMarkdownRow(row)[0].replaceAll('*', '')));
  assert.ok(blockerIds.size > 0, 'decision matrix must define its external blockers');
  for (const row of blockerRows) {
    const cells = parseMarkdownRow(row);
    assert.equal(cells.length, 5, `blocker has an unexpected column count: ${cells[0]}`);
    assert.ok(cells.every(Boolean), `blocker has an empty blocker/owner/effort/evidence field: ${cells[0]}`);
  }
  for (const row of decisionRows) {
    const cells = parseMarkdownRow(row);
    for (const vendorCell of cells.slice(3, 5)) {
      const statuses = vendorCell.match(/(?:PASS|PARTIAL|BLOCKED — EXTERNAL)/g) ?? [];
      assert.equal(statuses.length, 1, `criterion ${cells[0]} vendor cell must have exactly one status`);
      if (statuses[0] !== 'BLOCKED — EXTERNAL') continue;
      const references = vendorCell.match(/B-[A-Z]+/g) ?? [];
      assert.ok(references.length > 0, `blocked criterion ${cells[0]} lacks a blocker reference`);
      for (const reference of references) {
        assert.ok(blockerIds.has(reference), `blocked criterion ${cells[0]} references undefined ${reference}`);
      }
    }
  }
  assert.match(decision, /✅ \*\*PASS\*\*/);
  assert.match(decision, /⚠️ \*\*PARTIAL\*\*/);
  assert.match(decision, /❌ \*\*BLOCKED — EXTERNAL\*\*/);
  assert.match(decision, /## Manufacturer profile: Yongyida/);
  assert.match(decision, /## Manufacturer profile: Jiangzhi Robot/);
  assert.match(decision, /## Evidence register/);
  for (const prefix of ['Y', 'J']) {
    const cited = new Set([...decision.matchAll(new RegExp(`\\[${prefix}(\\d+)\\]`, 'g'))]
      .map((match) => `${prefix}${match[1]}`));
    const defined = new Set([...decision.matchAll(new RegExp(`^- \\*\\*\\[${prefix}(\\d+)\\]`, 'gm'))]
      .map((match) => `${prefix}${match[1]}`));
    assert.deepEqual([...cited].sort(), [...defined].sort(), `${prefix} evidence references must be defined exactly once`);
  }

  const requirements = read('docs/manufacturer-api-requirements.md');
  for (const heading of [
    '## Core API',
    '## Telemetry',
    '## Firmware and OTA',
    '## Security',
    '## Hardware',
    '## Medical sensors — Jiangzhi only'
  ]) assert.ok(requirements.includes(heading), `missing ${heading}`);
  const requirementRows = requirements.match(/^\| (?:API|TEL|OTA|SEC|HW|MED)-\d{3} \|.*$/gm) ?? [];
  assert.equal(requirementRows.length, 64, 'technical-package checklist must retain all 64 requirements');
  const expectedRequirementsByCategory = Object.freeze({
    API: 13,
    TEL: 11,
    OTA: 7,
    SEC: 11,
    HW: 11,
    MED: 11
  });
  const requirementIds = requirementRows.map((row) => parseMarkdownRow(row)[0]);
  assert.equal(new Set(requirementIds).size, 64, 'requirement IDs must be unique');
  for (const [prefix, expectedCount] of Object.entries(expectedRequirementsByCategory)) {
    assert.equal(
      requirementIds.filter((id) => id.startsWith(`${prefix}-`)).length,
      expectedCount,
      `${prefix} requirement count drifted`
    );
  }
  for (const row of requirementRows) {
    const cells = parseMarkdownRow(row);
    assert.equal(cells.length, 9, `external requirement has an unexpected column count: ${cells[0]}`);
    assert.ok(cells.every(Boolean), `external requirement has an empty field: ${cells[0]}`);
    assert.equal(cells[5], 'BLOCKED — EXTERNAL', `external requirement lacks status: ${cells[0]}`);
  }
});

test('external dashboard contains exactly 13 blocked dependencies and six completed artifacts', () => {
  const dashboard = read('docs/external-dependencies-dashboard.md');
  assert.match(dashboard, /\*\*Total External Dependencies:\*\* 13/);
  assert.match(dashboard, /\*\*PASS \(Completed\):\*\* 0\/13/);
  assert.match(dashboard, /\*\*BLOCKED — EXTERNAL:\*\* 13\/13/);
  assert.match(dashboard, /\*\*Next Unblocking Milestone:\*\* Grace signs mutual NDAs with both manufacturers/);

  const dependencyRows = dashboard.match(/^\| EXT-\d{3} \|.*$/gm) ?? [];
  assert.equal(dependencyRows.length, 13);
  const dependencyIds = dependencyRows.map((row) => parseMarkdownRow(row)[0]);
  assert.deepEqual(dependencyIds, Array.from({ length: 13 }, (_, index) => `EXT-${String(index + 1).padStart(3, '0')}`));
  for (const row of dependencyRows) {
    const cells = parseMarkdownRow(row);
    assert.equal(cells.length, 8, `dependency has an unexpected column count: ${cells[0]}`);
    assert.ok(cells.every(Boolean), `dependency has an empty field: ${cells[0]}`);
    assert.equal(cells[5], 'BLOCKED — EXTERNAL');
  }

  const detailRows = dashboard.match(/^\| Details for EXT-\d{3} \|.*$/gm) ?? [];
  assert.equal(detailRows.length, 13);
  const detailedIds = [];
  for (const row of detailRows) {
    const cells = parseMarkdownRow(row);
    assert.equal(cells.length, 6, `dependency detail has an unexpected column count: ${cells[0]}`);
    assert.ok(cells.every(Boolean), `dependency detail has an empty blocker/action/owner/effort/evidence field: ${cells[0]}`);
    detailedIds.push(cells[0].replace('Details for ', ''));
  }
  assert.deepEqual(detailedIds, dependencyIds, 'every external dependency must have exactly one matching action record');

  const internalSection = dashboard.split('## Internal deliverables checklist')[1]
    ?.split('## External dependency register')[0] ?? '';
  const completedArtifacts = internalSection.match(/^\| [^|]+ \| .* \| PASS \|$/gm) ?? [];
  assert.equal(completedArtifacts.length, 6);
});

test('timeline preserves three scenarios while keeping external gates explicit', () => {
  const timeline = read('docs/integration-timeline.md');
  assert.match(timeline, /Best Case \(All Docs Ready\)/);
  assert.match(timeline, /Realistic \(Delayed Docs\)/);
  assert.match(timeline, /Worst Case \(No Docs\)/);
  assert.match(timeline, /\| \*\*1\. NDA Signed\*\* \| Day 0 \| Day 7 \| Day 30 \|/);
  assert.match(timeline, /\| \*\*7\. Pilot Launch\*\* \| Day 21 \| Day 42 \| Day 120 \|/);

  const currentPhaseRows = timeline.match(/^\| [1-7]\. .* \| (?:PASS|IN PROGRESS|BLOCKED — EXTERNAL) \|.*$/gm) ?? [];
  assert.equal(currentPhaseRows.length, 7);
  assert.ok(currentPhaseRows.some((row) => row.includes('| PASS |')));
  assert.ok(currentPhaseRows.some((row) => row.includes('| BLOCKED — EXTERNAL |')));
  assert.match(timeline, /dependency-consistent cumulative schedule/i);

  const cumulativeSection = timeline.split('## Dependency-consistent cumulative schedule')[1]
    ?.split('### How to read the worst case')[0] ?? '';
  const cumulativeRows = cumulativeSection.split('\n').filter((row) => /^\| \*\*[1-7]\./.test(row));
  assert.equal(cumulativeRows.length, 7);
  for (const scenarioColumn of [2, 3, 4]) {
    const days = cumulativeRows.map((row) => firstDay(parseMarkdownRow(row)[scenarioColumn]));
    assert.ok(days[1] >= days[0], `technical package precedes NDA in scenario column ${scenarioColumn}`);
    assert.ok(days[2] >= days[1], `vendor translation precedes technical package in scenario column ${scenarioColumn}`);
    assert.ok(days[3] >= days[2], `vendor-fixture conformance precedes translation in scenario column ${scenarioColumn}`);
    assert.ok(days[5] >= Math.max(days[2], days[3], days[4]), `real-world testing precedes a prerequisite in scenario column ${scenarioColumn}`);
    assert.ok(days[6] >= days[5], `pilot precedes real-world testing in scenario column ${scenarioColumn}`);
  }
});

test('Grace ask templates are copy-ready and prohibit insecure credential delivery', () => {
  const asks = read('docs/ask-templates.md');
  for (const subject of [
    'Request for Mutual NDA and Technical Collaboration',
    'Request for Product 2 Technical Integration Package',
    'Request for Product 2 Engineering Sample Units',
    'Production Account and Secret Provisioning Request'
  ]) assert.ok(asks.includes(subject), `missing template: ${subject}`);
  assert.match(asks, /approved deployment secret manager/i);
  assert.match(asks, /do not send values or credential files by email/i);
  assert.match(asks, /Never expose these credentials through `EXPO_PUBLIC_\*`/);
});

test('new Product 2 artifacts contain no recognizable private key or cloud credential', () => {
  const files = [
    ...DOCUMENTS,
    'README.md',
    'docs/robot-adapter-integration-guide.md',
    'server/mocks/ManufacturerMockServer.ts'
  ];
  const contents = files.map((relativePath) => read(relativePath)).join('\n');
  assert.doesNotMatch(contents, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(contents, /AKIA[0-9A-Z]{16}/);
  assert.doesNotMatch(contents, /AIza[0-9A-Za-z_-]{35}/);
});

test('new Product 2 documentation contains no broken local Markdown links', () => {
  const files = [
    ...DOCUMENTS,
    'README.md',
    'docs/robot-adapter-integration-guide.md'
  ];

  for (const relativePath of files) {
    const contents = read(relativePath);
    const links = [...contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const link of links) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const target = decodeURIComponent(link.split('#')[0].split('?')[0]);
      if (!target) continue;
      const resolved = path.resolve(ROOT, path.dirname(relativePath), target);
      assert.ok(fs.existsSync(resolved), `${relativePath} contains a broken local link: ${link}`);
    }
  }
});
