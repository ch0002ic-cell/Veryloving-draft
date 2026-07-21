#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const {
  mkdirSync,
  readFileSync,
  writeFileSync
} = require('node:fs');
const { dirname, isAbsolute, join, resolve } = require('node:path');

const PROJECT_ROOT = resolve(__dirname, '..');
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const REGISTRY_TARBALL = /^https:\/\/registry\.npmjs\.org\//;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validatePolicy(policy) {
  invariant(policy?.contractVersion === 'veryloving.release-policy/1', 'Unknown release policy contract');
  invariant(EXACT_SEMVER.test(policy.nodeVersion || ''), 'release-policy nodeVersion must be exact');
  invariant(EXACT_SEMVER.test(policy.npmVersion || ''), 'release-policy npmVersion must be exact');
  invariant(EXACT_SEMVER.test(policy.easCliVersion || ''), 'release-policy easCliVersion must be exact');
  const imageMatch = /^node:(\d+\.\d+\.\d+)-alpine(\d+\.\d+)@(sha256:[0-9a-f]{64})$/.exec(
    policy.nodeImage || ''
  );
  invariant(imageMatch, 'release-policy nodeImage must contain an exact Node/Alpine tag and sha256 digest');
  invariant(imageMatch[1] === policy.nodeVersion, 'nodeImage and nodeVersion must match');
  invariant(SHA256_DIGEST.test(imageMatch[3]), 'nodeImage digest is invalid');
  invariant(policy.sbomFormat === 'CycloneDX 1.5', 'Only CycloneDX 1.5 SBOMs are accepted');
  invariant(['moderate', 'high', 'critical'].includes(policy.auditLevel), 'Unsupported npm audit level');
  return policy;
}

function validateManifestAndLock(manifest, lockfile, label, policy) {
  invariant(lockfile.lockfileVersion === 3, `${label} lockfileVersion must be 3`);
  invariant(lockfile.packages && typeof lockfile.packages === 'object', `${label} lockfile packages are missing`);
  const root = lockfile.packages[''];
  invariant(root && typeof root === 'object', `${label} lockfile root package is missing`);
  invariant(root.name === manifest.name, `${label} manifest and lockfile names differ`);
  invariant(root.version === manifest.version, `${label} manifest and lockfile versions differ`);

  for (const dependencyField of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const expected = manifest[dependencyField] || {};
    const locked = root[dependencyField] || {};
    invariant(
      JSON.stringify(locked) === JSON.stringify(expected),
      `${label} ${dependencyField} differ between package.json and package-lock.json`
    );
  }

  for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
    if (!packagePath || entry.link) continue;
    invariant(EXACT_SEMVER.test(entry.version || ''), `${label} ${packagePath} has a non-exact locked version`);
    if (!entry.resolved) continue;
    invariant(REGISTRY_TARBALL.test(entry.resolved), `${label} ${packagePath} is not resolved from the HTTPS npm registry`);
    invariant(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity || ''), `${label} ${packagePath} lacks sha512 integrity`);
  }

  if (label === 'root') {
    invariant(manifest.packageManager === `npm@${policy.npmVersion}`, 'root packageManager must match release-policy npmVersion');
    invariant(manifest.engines?.node === policy.nodeVersion, 'root Node engine must match release-policy nodeVersion');
  } else {
    invariant(manifest.engines?.node === policy.nodeVersion, `${label} Node engine must match release-policy nodeVersion`);
  }
}

function validateDockerfile(source, policy) {
  const fromLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^FROM\s+/i.test(line));
  invariant(fromLines.length === 2, 'Dockerfile must use exactly two stages');
  invariant(fromLines[0] === `FROM ${policy.nodeImage} AS build`, 'Docker build stage must use the reviewed immutable Node image');
  invariant(fromLines[1] === `FROM ${policy.nodeImage}`, 'Docker runtime stage must use the reviewed immutable Node image');
  invariant(/RUN npm ci --ignore-scripts(?:\s|$)/.test(source), 'Docker build stage must use npm ci --ignore-scripts');
  invariant(/RUN npm ci --omit=dev --ignore-scripts(?:\s|&&)/.test(source), 'Docker runtime stage must install only locked production dependencies');
  invariant(/\nUSER node\s*(?:\n|$)/.test(source), 'Docker runtime must use the non-root node user');
  invariant(/\nHEALTHCHECK\s/.test(source), 'Docker runtime must declare a health check');
  invariant(/CMD \["node", "clm-server\.cjs"\]/.test(source), 'Docker runtime entrypoint is unexpected');
}

function validateEAS(eas, policy) {
  invariant(eas?.cli?.version === policy.easCliVersion, 'eas.json must require the reviewed exact EAS CLI version');
  invariant(eas.cli.requireCommit === true, 'EAS builds must reject dirty/uncommitted source');
  invariant(eas.build?.production?.distribution === 'store', 'EAS production must use store distribution');
  invariant(eas.build?.production?.environment === 'production', 'EAS production must use the production environment');
  invariant(eas.build?.testflight?.extends === 'production', 'EAS TestFlight must inherit the production profile');
  for (const profileName of ['development', 'preview', 'production']) {
    invariant(
      eas.build?.[profileName]?.node === policy.nodeVersion,
      `EAS ${profileName} must use the reviewed exact Node version`
    );
  }
}

function packageNameFromPath(packagePath, entry) {
  if (entry.name) return entry.name;
  const marker = 'node_modules/';
  const markerIndex = packagePath.lastIndexOf(marker);
  return markerIndex >= 0 ? packagePath.slice(markerIndex + marker.length) : packagePath;
}

function packagePurl(name, version) {
  let encodedName = encodeURIComponent(name);
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    encodedName = `%40${encodeURIComponent(name.slice(1, slash))}/${encodeURIComponent(name.slice(slash + 1))}`;
  }
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function integrityHash(integrity) {
  const separator = integrity.indexOf('-');
  if (separator < 1 || integrity.slice(0, separator).toLowerCase() !== 'sha512') return undefined;
  return {
    alg: 'SHA-512',
    content: Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex')
  };
}

function createCycloneDxBom(manifest, lockfile, label) {
  const lockDigest = crypto.createHash('sha256').update(`${JSON.stringify(lockfile)}\n`).digest('hex');
  const components = Object.entries(lockfile.packages)
    .filter(([packagePath, entry]) => packagePath && !entry.link && entry.dev !== true)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packagePath, entry]) => {
      const name = packageNameFromPath(packagePath, entry);
      const purl = packagePurl(name, entry.version);
      const component = {
        'bom-ref': `urn:veryloving:npm:${crypto.createHash('sha256').update(`${packagePath}\0${name}\0${entry.version}`).digest('hex')}`,
        type: 'library',
        name,
        version: entry.version,
        scope: 'required',
        purl,
        properties: [{ name: 'veryloving:npm:lock-path', value: packagePath }]
      };
      const hash = integrityHash(entry.integrity || '');
      if (hash) component.hashes = [hash];
      if (typeof entry.license === 'string' && entry.license) {
        component.licenses = [{ license: { name: entry.license } }];
      }
      return component;
    });

  invariant(components.length > 0, `${label} production SBOM would be empty`);
  return {
    $schema: 'https://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ vendor: 'Veryloving.ai', name: 'release-supply-chain', version: '1' }],
      component: {
        'bom-ref': `pkg:npm/${encodeURIComponent(manifest.name)}@${encodeURIComponent(manifest.version)}`,
        type: 'application',
        name: manifest.name,
        version: manifest.version,
        purl: packagePurl(manifest.name, manifest.version),
        properties: [
          { name: 'veryloving:source', value: label },
          { name: 'veryloving:npm:lockfile-sha256', value: lockDigest }
        ]
      }
    },
    components
  };
}

function validateBom(bom, manifest) {
  invariant(bom.bomFormat === 'CycloneDX' && bom.specVersion === '1.5', 'Generated SBOM format is invalid');
  invariant(bom.metadata?.component?.name === manifest.name, 'Generated SBOM root component is invalid');
  invariant(Array.isArray(bom.components) && bom.components.length > 0, 'Generated SBOM has no components');
  const references = new Set();
  for (const component of bom.components) {
    invariant(component.name && EXACT_SEMVER.test(component.version || ''), 'Generated SBOM component is incomplete');
    invariant(!references.has(component['bom-ref']), 'Generated SBOM contains a duplicate bom-ref');
    references.add(component['bom-ref']);
  }
}

function loadProject(projectRoot = PROJECT_ROOT) {
  const policy = validatePolicy(readJSON(join(projectRoot, 'release-policy.json')));
  const rootManifest = readJSON(join(projectRoot, 'package.json'));
  const rootLockfile = readJSON(join(projectRoot, 'package-lock.json'));
  const serverManifest = readJSON(join(projectRoot, 'server/package.json'));
  const serverLockfile = readJSON(join(projectRoot, 'server/package-lock.json'));
  return { policy, rootManifest, rootLockfile, serverManifest, serverLockfile };
}

function validateSupplyChain(projectRoot = PROJECT_ROOT) {
  const project = loadProject(projectRoot);
  validateManifestAndLock(project.rootManifest, project.rootLockfile, 'root', project.policy);
  validateManifestAndLock(project.serverManifest, project.serverLockfile, 'server', project.policy);
  validateDockerfile(readFileSync(join(projectRoot, 'server/Dockerfile'), 'utf8'), project.policy);
  validateEAS(readJSON(join(projectRoot, 'eas.json')), project.policy);
  return {
    nodeImage: project.policy.nodeImage,
    easCliVersion: project.policy.easCliVersion,
    rootPackages: Object.keys(project.rootLockfile.packages).length - 1,
    serverPackages: Object.keys(project.serverLockfile.packages).length - 1
  };
}

function writeProductionSboms(outputDirectory, projectRoot = PROJECT_ROOT) {
  invariant(typeof outputDirectory === 'string' && outputDirectory.length > 0, 'SBOM output directory is required');
  const resolvedOutput = isAbsolute(outputDirectory) ? outputDirectory : resolve(projectRoot, outputDirectory);
  const project = loadProject(projectRoot);
  validateSupplyChain(projectRoot);
  const documents = [
    ['mobile-root.cdx.json', project.rootManifest, project.rootLockfile, 'mobile-root'],
    ['server.cdx.json', project.serverManifest, project.serverLockfile, 'server']
  ];
  mkdirSync(resolvedOutput, { recursive: true });
  const written = [];
  for (const [fileName, manifest, lockfile, label] of documents) {
    const bom = createCycloneDxBom(manifest, lockfile, label);
    validateBom(bom, manifest);
    const outputPath = join(resolvedOutput, fileName);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, { flag: 'w', mode: 0o600 });
    written.push({ outputPath, components: bom.components.length });
  }
  return written;
}

function parseArguments(argv) {
  const command = argv[0] || 'validate';
  invariant(command === 'validate' || command === 'sbom', 'Usage: release-supply-chain.cjs [validate|sbom] [--output <directory>]');
  let output = 'release-artifacts/sbom';
  for (let index = 1; index < argv.length; index += 1) {
    invariant(argv[index] === '--output' && argv[index + 1], 'Usage: release-supply-chain.cjs [validate|sbom] [--output <directory>]');
    output = argv[index + 1];
    index += 1;
  }
  return { command, output };
}

function run(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    const result = validateSupplyChain();
    process.stdout.write(`Supply-chain policy passed: ${result.nodeImage}; EAS CLI ${result.easCliVersion}; ${result.rootPackages + result.serverPackages} locked packages.\n`);
    if (options.command === 'sbom') {
      const written = writeProductionSboms(options.output);
      for (const artifact of written) {
        process.stdout.write(`SBOM: ${artifact.outputPath} (${artifact.components} production components)\n`);
      }
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Supply-chain validation failed: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = run();

module.exports = {
  createCycloneDxBom,
  parseArguments,
  run,
  validateBom,
  validateDockerfile,
  validateEAS,
  validateManifestAndLock,
  validatePolicy,
  validateSupplyChain,
  writeProductionSboms
};
