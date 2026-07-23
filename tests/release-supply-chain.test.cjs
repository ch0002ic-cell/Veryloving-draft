'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createCycloneDxBom,
  validateBom,
  validateDockerfile,
  validateEAS,
  validateManifestAndLock,
  validatePolicy,
  validateSupplyChain,
  writeProductionSboms
} = require('../scripts/release-supply-chain.cjs');

const projectRoot = path.resolve(__dirname, '..');
const load = (relativePath) => JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));

test('release supply-chain policy pins tools, container stages, locks, and EAS builds', () => {
  const result = validateSupplyChain(projectRoot);
  const rootManifest = load('package.json');
  const serverManifest = load('server/package.json');
  assert.match(result.nodeImage, /^node:24\.18\.0-alpine3\.24@sha256:[0-9a-f]{64}$/);
  assert.equal(result.easCliVersion, '21.1.0');
  assert.match(result.npmIntegrity, /^sha512-/);
  assert.ok(result.rootPackages > Object.keys(rootManifest.dependencies).length);
  assert.ok(result.serverPackages > Object.keys(serverManifest.dependencies).length);
});

test('release policy rejects mutable tools and container images', () => {
  const policy = load('release-policy.json');
  assert.throws(() => validatePolicy({ ...policy, easCliVersion: '>= 21.0.0' }), /must be exact/);
  assert.throws(() => validatePolicy({ ...policy, nodeImage: 'node:22-alpine' }), /exact Node\/Alpine tag/);

  const dockerfile = fs.readFileSync(path.join(projectRoot, 'server/Dockerfile'), 'utf8');
  assert.throws(() => validateDockerfile(dockerfile.replace(policy.nodeImage, 'node:22-alpine'), policy), /immutable Node image/);
  assert.throws(() => validateEAS({ cli: { version: '>= 20.0.0', requireCommit: true }, build: {} }, policy), /exact EAS CLI/);
});

test('release policy requires the unused npm toolchain to be absent from the runtime image', () => {
  const policy = load('release-policy.json');
  const dockerfile = fs.readFileSync(path.join(projectRoot, 'server/Dockerfile'), 'utf8');
  const retainedNpm = dockerfile
    .replace('  && rm -rf /usr/local/lib/node_modules/npm \\\n', '')
    .replace('  && rm -f /usr/local/bin/npm /usr/local/bin/npx\n', '');
  const buildOnlyCleanup = retainedNpm.replace(
    `FROM ${policy.nodeImage} AS build\n`,
    `FROM ${policy.nodeImage} AS build\nRUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx\n`
  );

  assert.throws(() => validateDockerfile(retainedNpm, policy), /remove the unused bundled npm toolchain/);
  assert.throws(() => validateDockerfile(buildOnlyCleanup, policy), /remove the unused bundled npm toolchain/);
});

test('lock validation rejects manifest drift, alternate registries, and missing integrity', () => {
  const policy = load('release-policy.json');
  const manifest = load('server/package.json');
  const lockfile = load('server/package-lock.json');
  validateManifestAndLock(manifest, lockfile, 'server', policy);

  const driftedManifest = structuredClone(manifest);
  driftedManifest.dependencies.ws = '^8.0.0';
  assert.throws(() => validateManifestAndLock(driftedManifest, lockfile, 'server', policy), /dependencies differ/);

  const unsafeLockfile = structuredClone(lockfile);
  const packagePath = Object.keys(unsafeLockfile.packages).find((entry) => entry);
  unsafeLockfile.packages[packagePath].resolved = 'http://registry.example.invalid/package.tgz';
  delete unsafeLockfile.packages[packagePath].integrity;
  assert.throws(() => validateManifestAndLock(manifest, unsafeLockfile, 'server', policy), /HTTPS npm registry/);
});

test('CycloneDX production SBOMs are deterministic, exclude dev-only packages, and validate', () => {
  const manifest = load('server/package.json');
  const lockfile = load('server/package-lock.json');
  const first = createCycloneDxBom(manifest, lockfile, 'server');
  const second = createCycloneDxBom(manifest, lockfile, 'server');
  assert.deepEqual(first, second);
  validateBom(first, manifest);
  assert.equal(first.bomFormat, 'CycloneDX');
  assert.equal(first.specVersion, '1.5');
  assert.ok(first.components.every((component) => component.scope === 'required'));

  const devOnlyVersion = lockfile.packages['node_modules/typescript']?.version;
  if (devOnlyVersion) {
    assert.equal(first.components.some((component) => component.name === 'typescript' && component.version === devOnlyVersion), false);
  }
});

test('SBOM writer emits private, parseable mobile and server inventories', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veryloving-sbom-test-'));
  try {
    const written = writeProductionSboms(outputRoot, projectRoot);
    assert.deepEqual(written.map(({ outputPath }) => path.basename(outputPath)), ['mobile-root.cdx.json', 'server.cdx.json']);
    for (const artifact of written) {
      const stat = fs.statSync(artifact.outputPath);
      assert.equal(stat.mode & 0o077, 0);
      const bom = JSON.parse(fs.readFileSync(artifact.outputPath, 'utf8'));
      assert.equal(bom.bomFormat, 'CycloneDX');
      assert.equal(bom.components.length, artifact.components);
    }
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('local and live production gates remain distinct and CI actions are commit pinned', () => {
  const packageJSON = load('package.json');
  assert.equal(packageJSON.scripts['validate:production'], 'node scripts/validate-production.cjs');
  assert.equal(packageJSON.scripts['validate:production:release'], 'node scripts/validate-production.cjs --release');
  assert.equal(packageJSON.scripts['test:coverage'], 'npm run test:adapters && npm run test:ai-native');
  for (const scriptName of [
    'typecheck:adapters',
    'typecheck:manufacturer-mock',
    'typecheck:ai-native',
    'typecheck:tests',
    'build:adapters',
    'build:manufacturer-mock',
    'build:ai-native'
  ]) {
    assert.match(
      packageJSON.scripts[scriptName],
      /^npm --prefix server exec -- tsc -p server\/tsconfig\.[a-z-]+\.json(?: --noEmit)?$/,
      `${scriptName} must use the server-pinned TypeScript compiler`
    );
  }
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/production-validation.yml'), 'utf8');
  assert.match(workflow, /npm run validate:production:release/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.equal((workflow.match(/npm install --global npm@12\.0\.1 --ignore-scripts --no-audit --no-fund/g) || []).length, 2);
  assert.match(workflow, /docker\/setup-buildx-action@[0-9a-f]{40}/);
  assert.match(workflow, /aquasecurity\/trivy-action@[0-9a-f]{40}/);
  assert.match(workflow, /image-ref:\s+veryloving-clm:production-validation/);
  assert.match(workflow, /severity:\s+CRITICAL,HIGH/);
  assert.match(workflow, /exit-code:\s+'1'/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/);
});
