// Enforces SERVICE-BOUNDARIES.md §4 across workspace packages.
// Usage: node scripts/check-boundaries.mjs   (exit 1 on any violation)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IO_MODULES,
  LIBRARY_RULES,
  PROVIDER_SDKS,
  PURE_LIBRARIES,
  SCOPE,
  WEB_ALLOWED,
} from './boundaries.rules.mjs';

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage']);
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Classify a workspace directory (posix, relative to repo root). */
export function classify(dir) {
  const [top, name] = dir.split('/');
  if (top === 'packages') {
    return name.startsWith('adapter-') ? { kind: 'adapter', name } : { kind: 'library', name };
  }
  if (dir === 'apps/web') return { kind: 'web', name: 'web' };
  if (top === 'apps' || top === 'workers') return { kind: 'process', name: dir };
  return { kind: 'unknown', name: dir };
}

/** Bare module name: "@scope/pkg/sub" → "@scope/pkg", "pkg/sub" → "pkg", "node:fs" → "fs". */
export function moduleName(spec) {
  const s = spec.startsWith('node:') ? spec.slice(5) : spec;
  const parts = s.split('/');
  return s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const isProviderSdk = (mod) =>
  PROVIDER_SDKS.some((p) => (p.endsWith('/*') ? mod.startsWith(p.slice(0, -1)) : mod === p));

/**
 * Pure rule evaluation.
 * @param {{dir: string, name: string, dependencies: string[], imports: {file: string, spec: string, escapes?: boolean}[], processNames: string[]}} pkg
 * @returns {string[]} violations
 */
export function checkPackage(pkg) {
  const role = classify(pkg.dir);
  const out = [];
  const where = (file) => `${pkg.dir}${file ? `/${file}` : ''}`;

  if (role.kind === 'unknown') return [`${pkg.dir}: not a recognised workspace location`];
  if ((role.kind === 'library' || role.kind === 'adapter') && pkg.name !== `${SCOPE}${role.name}`) {
    out.push(`${pkg.dir}: package must be named ${SCOPE}${role.name} (found ${pkg.name})`);
  }
  if (role.kind === 'library' && !(role.name in LIBRARY_RULES)) {
    out.push(`${pkg.dir}: library "${role.name}" has no rule in scripts/boundaries.rules.mjs`);
  }

  const internalAllowed = (target) => {
    const t = classify(`packages/${target}`);
    switch (role.kind) {
      case 'library': return (LIBRARY_RULES[role.name] ?? []).includes(target);
      case 'adapter': return t.kind === 'library';
      case 'web': return WEB_ALLOWED.includes(target);
      case 'process': return true;
      default: return false;
    }
  };

  const checkModule = (mod, label) => {
    if (mod.startsWith(SCOPE)) {
      const target = mod.slice(SCOPE.length);
      if (pkg.processNames.includes(mod)) {
        out.push(`${label}: must not import process code ${mod}`);
      } else if (!internalAllowed(target)) {
        out.push(`${label}: ${role.kind} "${role.name}" may not import ${mod}`);
      }
      return;
    }
    if (isProviderSdk(mod) && role.kind !== 'adapter') {
      out.push(`${label}: provider SDK "${mod}" may only be imported by packages/adapter-*`);
    }
    if (role.kind === 'library' && PURE_LIBRARIES.includes(role.name) && IO_MODULES.includes(mod)) {
      out.push(`${label}: pure library "${role.name}" may not import I/O module "${mod}"`);
    }
  };

  for (const dep of pkg.dependencies) checkModule(dep, `${where('package.json')}`);
  for (const { file, spec, escapes } of pkg.imports) {
    if (spec.startsWith('.')) {
      if (escapes) out.push(`${where(file)}: relative import "${spec}" leaves the package`);
      continue;
    }
    checkModule(moduleName(spec), where(file));
  }
  return out;
}

function listWorkspaceDirs(root) {
  const globs = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
    .split('\n').map((l) => l.match(/^\s*-\s*['"]?([^'"]+)\/\*['"]?\s*$/)?.[1]).filter(Boolean);
  return globs.flatMap((base) => {
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(abs, d.name, 'package.json')))
      .map((d) => `${base}/${d.name}`);
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

export function scanImports(pkgAbs) {
  return walk(pkgAbs).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(IMPORT_RE)].map((m) => {
      const spec = m[1] ?? m[2] ?? m[3];
      const resolved = path.resolve(path.dirname(file), spec);
      return {
        file: path.relative(pkgAbs, file).split(path.sep).join('/'),
        spec,
        escapes: spec.startsWith('.') && path.relative(pkgAbs, resolved).startsWith('..'),
      };
    });
  });
}

export function checkRepo(root) {
  const dirs = listWorkspaceDirs(root);
  const manifests = dirs.map((dir) => ({ dir, json: JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')) }));
  const processNames = manifests.filter((m) => classify(m.dir).kind === 'process' || m.dir === 'apps/web').map((m) => m.json.name);
  const violations = manifests.flatMap(({ dir, json }) => checkPackage({
    dir,
    name: json.name,
    dependencies: Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.peerDependencies }),
    imports: scanImports(path.join(root, dir)),
    processNames: processNames.filter((n) => n !== json.name),
  }));
  return { packages: dirs, violations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { packages, violations } = checkRepo(root);
  if (violations.length) {
    console.error(`Boundary violations (${violations.length}):\n${violations.map((v) => `  - ${v}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Boundaries OK: ${packages.length} workspace packages checked (${packages.join(', ')}).`);
}
