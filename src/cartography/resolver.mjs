// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${configDir} is the literal tsconfig placeholder (TypeScript 5.5).
/**
 * Specifier resolution for brownfield cartography (blueprint §4.3.2) without dependencies, without
 * `npm install` and without symlinks: tsconfig/jsconfig `paths` with recursive `extends` and
 * longest-prefix matching, package.json `imports`, pnpm/npm/yarn workspaces with `exports`, plus
 * minimal Python, Go, Rust and Java resolvers. All paths are POSIX and relative to the project root.
 */
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';
import { listProjectFiles } from './files.mjs';

const TS_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
/** D-8: condition order for package `exports` and `imports`. */
export const CONDITION_ORDER = ['source', 'types', 'import', 'module', 'require', 'node', 'default'];
const BUILD_DIRECTORIES = new Set(['dist', 'build', 'lib', 'out']);
const BUILTINS = new Set(builtinModules);
const CONFIG_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
]);

/** Files whose content changes how specifiers resolve; cartography re-resolves when they change. */
export function isResolutionConfig(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return CONFIG_NAMES.has(name) || /^(?:ts|js)config(?:\..+)?\.json$/.test(name);
}

/** JSON with comments and trailing commas (tsconfig/jsconfig), string-aware. */
export function parseJsonc(text) {
  const source = text.replace(/^﻿/, '');
  let stripped = '';
  let index = 0;
  let copied = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      index++;
      while (index < source.length && source[index] !== '"') index += source[index] === '\\' ? 2 : 1;
      index++;
      continue;
    }
    if (character === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      stripped += source.slice(copied, index);
      const end =
        source[index + 1] === '/'
          ? (() => {
              const lf = source.indexOf('\n', index);
              return lf === -1 ? source.length : lf;
            })()
          : (() => {
              const close = source.indexOf('*/', index + 2);
              return close === -1 ? source.length : close + 2;
            })();
      stripped += ' ';
      index = end;
      copied = end;
      continue;
    }
    index++;
  }
  stripped += source.slice(copied);
  let output = '';
  copied = 0;
  for (index = 0; index < stripped.length; index++) {
    const character = stripped[index];
    if (character === '"') {
      index++;
      while (index < stripped.length && stripped[index] !== '"') index += stripped[index] === '\\' ? 2 : 1;
      continue;
    }
    if (character === ',') {
      let next = index + 1;
      while (next < stripped.length && /\s/.test(stripped[next])) next++;
      if (stripped[next] === '}' || stripped[next] === ']') {
        output += stripped.slice(copied, index);
        copied = index + 1;
      }
    }
  }
  return JSON.parse(output + stripped.slice(copied));
}

/** The `packages:` list of a pnpm-workspace.yaml (block or flow style). */
export function parsePnpmWorkspace(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const unquote = value =>
    value
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  const start = lines.findIndex(line => /^packages\s*:/.test(line));
  if (start === -1) return [];
  const inline = lines[start].replace(/^packages\s*:/, '').trim();
  if (inline.startsWith('['))
    return inline
      .replace(/^\[|\].*$/g, '')
      .split(',')
      .map(unquote)
      .filter(Boolean);
  const packages = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (item) packages.push(unquote(item[1]));
  }
  return packages.filter(Boolean);
}

/** Workspace glob (`*`, `**`, `?`) to an anchored regular expression over POSIX paths. */
export function globToRegExp(pattern) {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  let source = '';
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index];
    if (character === '*' && clean[index + 1] === '*') {
      const slashAfter = clean[index + 2] === '/';
      source += slashAfter ? '(?:.*/)?' : '.*';
      index += slashAfter ? 2 : 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[\\^$.+()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${source.replace(/\/\.\*$/, '(?:/.*)?')}$`);
}

const dirnameOf = path => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};
const joinPath = (...parts) => {
  const joined = posix.normalize(parts.filter(part => part !== '').join('/'));
  return joined === '.' ? '' : joined.replace(/\/$/, '');
};
const outsideRoot = path => path === '..' || path.startsWith('../') || posix.isAbsolute(path);
const packageName = specifier => {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/**
 * @param {string} root Project root.
 * @param {{files?: Iterable<string>, caseInsensitive?: boolean}} [options] `files` defaults to a walk of
 *   the project (ignored paths excluded); `caseInsensitive` defaults to the platform's file system.
 */
export function createResolver(root, options = {}) {
  const files = new Set(options.files ?? listProjectFiles(root));
  const caseInsensitive = options.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin');
  const warnings = [];
  const warned = new Set();
  const warn = (code, path, message) => {
    const key = `${code}\0${path}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({ code, path, message });
  };
  let lowerCase = null;
  const lowerMap = () => {
    if (!lowerCase) {
      lowerCase = new Map();
      for (const file of files) if (!lowerCase.has(file.toLowerCase())) lowerCase.set(file.toLowerCase(), file);
    }
    return lowerCase;
  };
  let directoryIndex = null;
  const filesIn = directory => {
    if (!directoryIndex) {
      directoryIndex = new Map();
      for (const file of files) {
        const parent = dirnameOf(file);
        if (!directoryIndex.has(parent)) directoryIndex.set(parent, []);
        directoryIndex.get(parent).push(file);
      }
      for (const list of directoryIndex.values()) list.sort();
    }
    return directoryIndex.get(directory) ?? [];
  };

  const readText = path => {
    try {
      return fs.readFileSync(join(root, ...path.split('/')), 'utf8');
    } catch (error) {
      // A missing config is a normal resolution outcome; any other I/O failure is real.
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return null;
      throw error;
    }
  };
  const jsonCache = new Map();
  const readJson = (path, { jsonc = false, code = 'JSON_INVALID' } = {}) => {
    if (jsonCache.has(path)) return jsonCache.get(path);
    const text = readText(path);
    let value = null;
    if (text !== null) {
      try {
        value = jsonc ? parseJsonc(text) : JSON.parse(text.replace(/^﻿/, ''));
      } catch (error) {
        warn(code, path, `${path}: ${error.message}`);
      }
    }
    jsonCache.set(path, value);
    return value;
  };

  /** First existing candidate; exact names win, case-insensitive matches are flagged. */
  const firstExisting = candidates => {
    for (const candidate of candidates) if (files.has(candidate)) return { path: candidate, flags: [] };
    if (caseInsensitive) {
      const map = lowerMap();
      for (const candidate of candidates) {
        const real = map.get(candidate.toLowerCase());
        if (real) return { path: real, flags: ['case-mismatch'] };
      }
    }
    return null;
  };
  const probeCandidates = base => {
    const candidates = [base];
    for (const [extension, replacements] of Object.entries(JS_TO_TS))
      if (base.endsWith(extension))
        for (const replacement of replacements) candidates.push(base.slice(0, -extension.length) + replacement);
    for (const extension of TS_EXTENSIONS) candidates.push(base + extension);
    for (const extension of TS_EXTENSIONS) candidates.push(`${base}/index${extension}`);
    return candidates;
  };
  const probe = base => (outsideRoot(base) ? null : firstExisting(probeCandidates(base)));
  /** Probe a package target; a missing build output falls back to the matching source under src/. */
  const probeTarget = path => {
    const found = probe(path);
    if (found) return found;
    const segments = path.split('/');
    const build = segments.findIndex(segment => BUILD_DIRECTORIES.has(segment));
    if (build === -1) return null;
    segments[build] = 'src';
    const source = segments.join('/').replace(/(\.d)?\.(?:[cm]?js|[cm]?ts|jsx)$/, '');
    const fallback = probe(source);
    return fallback ? { path: fallback.path, flags: [...fallback.flags, 'unbuilt'] } : null;
  };
  const internal = found =>
    found.flags.length
      ? { kind: 'internal', path: found.path, flags: found.flags }
      : { kind: 'internal', path: found.path };

  // ---- tsconfig / jsconfig -------------------------------------------------------------------
  const resolveExtends = (specifier, fromDirectory) => {
    if (specifier.startsWith('.') || posix.isAbsolute(specifier)) {
      const base = joinPath(fromDirectory, specifier);
      for (const candidate of [base, `${base}.json`])
        if (!outsideRoot(candidate) && readText(candidate) !== null) return candidate;
      return null;
    }
    for (let directory = fromDirectory; ; directory = dirnameOf(directory)) {
      const base = joinPath(directory, 'node_modules', specifier);
      for (const candidate of [base, `${base}.json`, `${base}/tsconfig.json`])
        if (readText(candidate) !== null && !candidate.endsWith('/')) return candidate;
      if (directory === '') return null;
    }
  };
  /** Merged compilerOptions of a config chain: { baseUrl?: {value, dir}, paths?: {value, dir}, chain }. */
  const loadChain = (path, visiting = new Set()) => {
    if (visiting.has(path)) {
      warn('TSCONFIG_EXTENDS_CYCLE', path, `extends cycle through ${path}`);
      return { chain: [] };
    }
    visiting.add(path);
    const config = readJson(path, { jsonc: true, code: 'TSCONFIG_INVALID' }) ?? {};
    const directory = dirnameOf(path);
    const merged = { chain: [path] };
    const parents =
      config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const parent of parents) {
      if (typeof parent !== 'string') continue;
      const parentPath = resolveExtends(parent, directory);
      if (!parentPath) {
        warn('TSCONFIG_EXTENDS_MISSING', path, `${path} extends ${parent}, which was not found`);
        continue;
      }
      const inherited = loadChain(parentPath, visiting);
      if (inherited.baseUrl) merged.baseUrl = inherited.baseUrl;
      if (inherited.paths) merged.paths = inherited.paths;
      merged.chain.push(...inherited.chain);
    }
    const options = config.compilerOptions ?? {};
    if (typeof options.baseUrl === 'string') merged.baseUrl = { value: options.baseUrl, dir: directory };
    if (options.paths && typeof options.paths === 'object') merged.paths = { value: options.paths, dir: directory };
    visiting.delete(path);
    return merged;
  };
  const configCache = new Map();
  const loadConfig = path => {
    if (configCache.has(path)) return configCache.get(path);
    const leaf = dirnameOf(path);
    const merged = loadChain(path);
    const place = ({ value, dir }) =>
      value.includes('${configDir}') ? joinPath(value.replaceAll('${configDir}', leaf)) : joinPath(dir, value);
    const baseUrl = merged.baseUrl ? place(merged.baseUrl) : null;
    const mappings = [];
    if (merged.paths) {
      const pathsBase = baseUrl ?? merged.paths.dir;
      for (const [pattern, targets] of Object.entries(merged.paths.value)) {
        const star = pattern.indexOf('*');
        mappings.push({
          wildcard: star !== -1,
          prefix: star === -1 ? pattern : pattern.slice(0, star),
          suffix: star === -1 ? '' : pattern.slice(star + 1),
          pattern,
          targets: (Array.isArray(targets) ? targets : [targets])
            .filter(target => typeof target === 'string')
            .map(target =>
              target.includes('${configDir}')
                ? { text: target.replaceAll('${configDir}', leaf), base: '' }
                : { text: target, base: pathsBase },
            ),
        });
      }
      mappings.sort((a, b) => (a.wildcard === b.wildcard ? b.prefix.length - a.prefix.length : a.wildcard ? 1 : -1));
    }
    const result = { baseUrl, mappings, chain: merged.chain };
    configCache.set(path, result);
    return result;
  };
  const nearestCache = new Map();
  const nearestConfig = directory => {
    if (nearestCache.has(directory)) return nearestCache.get(directory);
    let found = null;
    for (let current = directory; ; current = dirnameOf(current)) {
      const ts = joinPath(current, 'tsconfig.json');
      const js = joinPath(current, 'jsconfig.json');
      if (files.has(ts)) found = ts;
      else if (files.has(js)) found = js;
      if (found || current === '') break;
    }
    const config = found ? loadConfig(found) : null;
    nearestCache.set(directory, config);
    return config;
  };
  const matchPaths = (config, specifier) => {
    const best = config.mappings.find(mapping =>
      mapping.wildcard
        ? specifier.length >= mapping.prefix.length + mapping.suffix.length &&
          specifier.startsWith(mapping.prefix) &&
          specifier.endsWith(mapping.suffix)
        : specifier === mapping.pattern,
    );
    if (!best) return undefined;
    const captured = best.wildcard ? specifier.slice(best.prefix.length, specifier.length - best.suffix.length) : '';
    for (const target of best.targets) {
      const found = probe(joinPath(target.base, target.text.replace('*', captured)));
      if (found) return found;
    }
    return null;
  };

  // ---- package.json imports and workspaces ---------------------------------------------------
  const pickTarget = (value, resolveOne) => {
    if (typeof value === 'string') return resolveOne(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = pickTarget(item, resolveOne);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      for (const condition of CONDITION_ORDER) {
        if (!(condition in value)) continue;
        const found = pickTarget(value[condition], resolveOne);
        if (found) return found;
      }
    }
    return null;
  };
  /** Exact key, else the wildcard key with the longest prefix. */
  const matchSubpathMap = (map, key) => {
    if (Object.hasOwn(map, key) && !key.includes('*')) return { value: map[key], captured: '' };
    let best = null;
    for (const pattern of Object.keys(map)) {
      const star = pattern.indexOf('*');
      if (star === -1) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (key.length < prefix.length + suffix.length || !key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      if (!best || prefix.length > best.prefix.length)
        best = { prefix, value: map[pattern], captured: key.slice(prefix.length, key.length - suffix.length) };
    }
    return best;
  };
  const resolveInPackage = (directory, value, captured) =>
    pickTarget(value, target => probeTarget(joinPath(directory, target.replaceAll('*', captured))));

  const nearestPackage = directory => {
    for (let current = directory; ; current = dirnameOf(current)) {
      const path = joinPath(current, 'package.json');
      if (files.has(path)) return { directory: current, manifest: readJson(path) ?? {} };
      if (current === '') return null;
    }
  };

  let workspaceMap = null;
  const workspaces = () => {
    if (workspaceMap) return workspaceMap;
    workspaceMap = new Map();
    const rootManifest = files.has('package.json') ? (readJson('package.json') ?? {}) : {};
    const declared = Array.isArray(rootManifest.workspaces)
      ? rootManifest.workspaces
      : Array.isArray(rootManifest.workspaces?.packages)
        ? rootManifest.workspaces.packages
        : [];
    const patterns = [...declared];
    if (files.has('pnpm-workspace.yaml')) patterns.push(...parsePnpmWorkspace(readText('pnpm-workspace.yaml') ?? ''));
    const include = patterns.filter(pattern => !pattern.startsWith('!')).map(globToRegExp);
    const exclude = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => globToRegExp(pattern.slice(1)));
    if (!include.length) return workspaceMap;
    const candidates = [...files]
      .filter(file => file.endsWith('/package.json'))
      .map(dirnameOf)
      .filter(
        directory => include.some(regex => regex.test(directory)) && !exclude.some(regex => regex.test(directory)),
      )
      .sort();
    for (const directory of candidates) {
      const name = readJson(`${directory}/package.json`)?.name;
      if (typeof name !== 'string' || !name) continue;
      if (workspaceMap.has(name)) {
        warn(
          'WORKSPACE_DUPLICATE_NAME',
          directory,
          `${name} is declared by ${workspaceMap.get(name)} and ${directory}`,
        );
        continue;
      }
      workspaceMap.set(name, directory);
    }
    return workspaceMap;
  };
  const resolveWorkspace = specifier => {
    const map = workspaces();
    const name = packageName(specifier);
    const directory = map.get(name);
    if (directory === undefined) return undefined;
    const subpath = specifier === name ? '.' : `./${specifier.slice(name.length + 1)}`;
    const manifest = readJson(`${directory}/package.json`) ?? {};
    const { exports } = manifest;
    if (exports !== undefined && exports !== null) {
      const map =
        typeof exports === 'string' || Array.isArray(exports)
          ? { '.': exports }
          : Object.keys(exports).some(key => key.startsWith('.'))
            ? exports
            : { '.': exports };
      const match = matchSubpathMap(map, subpath);
      return match ? resolveInPackage(directory, match.value, match.captured) : null;
    }
    if (subpath === '.') {
      for (const field of ['main', 'module', 'types', 'typings']) {
        if (typeof manifest[field] !== 'string') continue;
        const found = probeTarget(joinPath(directory, manifest[field]));
        if (found) return found;
      }
      return probe(joinPath(directory, 'index'));
    }
    return probe(joinPath(directory, subpath));
  };

  // The directory fixes the nearest tsconfig and package scope, so (directory, specifier) is a sound key.
  const javaScriptCache = new Map();
  const resolveJavaScript = (specifier, importer) => {
    const directory = dirnameOf(importer);
    const key = `${directory}\u0000${specifier}`;
    let result = javaScriptCache.get(key);
    if (!result) {
      result = resolveJavaScriptUncached(specifier, directory);
      javaScriptCache.set(key, result);
    }
    return result;
  };
  const resolveJavaScriptUncached = (specifier, directory) => {
    // Loaded even for relative specifiers so a broken config is always reported (cached per directory).
    const config = nearestConfig(directory);
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
      const target = joinPath(directory, specifier);
      const found = outsideRoot(target) ? null : probe(target);
      return found ? internal(found) : { kind: 'unresolved', specifier };
    }
    if (specifier.startsWith('#')) {
      const scope = nearestPackage(directory);
      const imports = scope?.manifest.imports;
      const match = imports && typeof imports === 'object' ? matchSubpathMap(imports, specifier) : null;
      const found = match ? resolveInPackage(scope.directory, match.value, match.captured) : null;
      if (found) return internal(found);
    }
    if (config?.mappings.length) {
      const found = matchPaths(config, specifier);
      if (found) return internal(found);
    }
    if (specifier.startsWith('#')) return { kind: 'unresolved', specifier };
    const workspace = resolveWorkspace(specifier);
    if (workspace) return internal(workspace);
    if (workspace === null) return { kind: 'unresolved', specifier };
    if (config?.baseUrl !== null && config?.baseUrl !== undefined && !specifier.startsWith('node:')) {
      const found = probe(joinPath(config.baseUrl, specifier));
      if (found) return internal(found);
    }
    if (specifier.startsWith('node:') || BUILTINS.has(specifier)) return { kind: 'external', name: specifier };
    return { kind: 'external', name: packageName(specifier) };
  };

  // ---- Python ----------------------------------------------------------------------------------
  let pythonRootList = null;
  const pythonRoots = () => {
    if (pythonRootList) return pythonRootList;
    const roots = new Set(['']);
    if ([...files].some(file => file.startsWith('src/'))) roots.add('src');
    for (const file of files) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      if (name === 'pyproject.toml' || name === 'setup.py' || name === 'setup.cfg') {
        const directory = dirnameOf(file);
        roots.add(directory);
        if ([...files].some(other => other.startsWith(joinPath(directory, 'src') + '/')))
          roots.add(joinPath(directory, 'src'));
      }
    }
    pythonRootList = [...roots];
    return pythonRootList;
  };
  const probePython = base =>
    firstExisting([`${base}.py`, joinPath(base, '__init__.py')].filter(path => !outsideRoot(path)));
  const resolvePythonFrom = (base, record) => {
    const symbols = (record.symbols ?? ['*']).filter(symbol => symbol !== '*');
    const submodules = symbols.map(symbol => probePython(joinPath(base, symbol))).filter(Boolean);
    if (submodules.length) return submodules.map(internal);
    const module =
      probePython(base) ?? (base === '' || base.endsWith('/') ? firstExisting([joinPath(base, '__init__.py')]) : null);
    return module ? [internal(module)] : [];
  };
  const resolvePython = (record, importer) => {
    const level = record.level ?? /^\.*/.exec(record.specifier)[0].length;
    const modulePath = record.specifier.replace(/^\.+/, '').split('.').filter(Boolean).join('/');
    if (level > 0) {
      let base = dirnameOf(importer);
      for (let step = 1; step < level; step++) base = dirnameOf(base);
      const found = resolvePythonFrom(joinPath(base, modulePath), record);
      if (found.length) return found;
      if (!modulePath) {
        const init = firstExisting([joinPath(base, '__init__.py')]);
        if (init) return [internal(init)];
      }
      return [{ kind: 'unresolved', specifier: record.specifier }];
    }
    for (const root of pythonRoots()) {
      const found = resolvePythonFrom(joinPath(root, modulePath), record);
      if (found.length) return found;
    }
    return [{ kind: 'external', name: record.specifier.split('.')[0] }];
  };

  // ---- Go ------------------------------------------------------------------------------------
  let goModules = null;
  const resolveGo = record => {
    if (!goModules) {
      goModules = [...files]
        .filter(file => file === 'go.mod' || file.endsWith('/go.mod'))
        .map(file => ({ directory: dirnameOf(file), module: /^module\s+(\S+)/m.exec(readText(file) ?? '')?.[1] }))
        .filter(item => item.module)
        .sort((a, b) => b.module.length - a.module.length);
    }
    const { specifier } = record;
    const owner = goModules.find(item => specifier === item.module || specifier.startsWith(`${item.module}/`));
    if (!owner) return [{ kind: 'external', name: specifier }];
    const directory = joinPath(owner.directory, specifier.slice(owner.module.length + 1));
    const sources = filesIn(directory).filter(file => file.endsWith('.go') && !file.endsWith('_test.go'));
    return sources.length ? sources.map(path => ({ kind: 'internal', path })) : [{ kind: 'unresolved', specifier }];
  };

  // ---- Rust ----------------------------------------------------------------------------------
  const crateSource = importer => {
    for (let directory = dirnameOf(importer); ; directory = dirnameOf(directory)) {
      if (files.has(joinPath(directory, 'Cargo.toml'))) return joinPath(directory, 'src');
      if (directory === '') return 'src';
    }
  };
  const moduleSegments = (importer, source) => {
    const relative = importer.startsWith(`${source}/`) ? importer.slice(source.length + 1) : importer;
    if (relative === 'lib.rs' || relative === 'main.rs') return [];
    return relative
      .replace(/\.rs$/, '')
      .replace(/\/mod$/, '')
      .split('/');
  };
  const probeRust = (source, segments) =>
    segments.length
      ? firstExisting([`${joinPath(source, ...segments)}.rs`, joinPath(source, ...segments, 'mod.rs')])
      : firstExisting([joinPath(source, 'lib.rs'), joinPath(source, 'main.rs')]);
  const resolveRust = (record, importer) => {
    const source = crateSource(importer);
    const current = moduleSegments(importer, source);
    if (record.kind === 'mod') {
      const found = probeRust(source, [...current, record.specifier]);
      return [found ? internal(found) : { kind: 'unresolved', specifier: record.specifier }];
    }
    const parts = record.specifier.split('::');
    let base;
    if (parts[0] === 'crate') {
      base = [];
      parts.shift();
    } else if (parts[0] === 'self') {
      base = current;
      parts.shift();
    } else if (parts[0] === 'super') {
      base = current;
      while (parts[0] === 'super') {
        base = base.slice(0, -1);
        parts.shift();
      }
    } else return [{ kind: 'external', name: parts[0] }];
    for (let take = parts.length; take >= 0; take--) {
      const found = probeRust(source, [...base, ...parts.slice(0, take)]);
      if (found) return [internal(found)];
    }
    return [{ kind: 'unresolved', specifier: record.specifier }];
  };

  // ---- Java ----------------------------------------------------------------------------------
  let javaRootList = null;
  const javaRoots = () => {
    if (javaRootList) return javaRootList;
    const roots = new Set();
    for (const file of files) {
      const match = /^(.*?src\/(?:main|test)\/java)\//.exec(file);
      if (match) roots.add(match[1]);
    }
    javaRootList = [...[...roots].sort(), 'src', ''];
    return javaRootList;
  };
  const resolveJava = record => {
    const segments = record.specifier.split('.');
    if (record.wildcard) {
      for (const root of javaRoots()) {
        const classes = filesIn(joinPath(root, ...segments)).filter(file => file.endsWith('.java'));
        if (classes.length) return classes.map(path => ({ kind: 'internal', path }));
      }
      return [{ kind: 'external', name: record.specifier }];
    }
    const classSegments = record.static ? segments.slice(0, -1) : segments;
    const found = firstExisting(javaRoots().map(root => `${joinPath(root, ...classSegments)}.java`));
    if (found) return [internal(found)];
    const firstType = segments.findIndex(segment => /^[A-Z]/.test(segment));
    return [{ kind: 'external', name: segments.slice(0, firstType === -1 ? -1 : firstType).join('.') }];
  };

  const resolver = {
    root,
    warnings,
    get workspaces() {
      return workspaces();
    },
    /**
     * Resolves one specifier. JavaScript/TypeScript returns a single result; other languages return
     * the first result of `resolveImport`.
     * @returns {{kind:'internal', path:string, flags?:string[]}|{kind:'external', name:string}|{kind:'unresolved', specifier:string}}
     */
    resolve(specifier, importer, language = 'typescript') {
      if (language === 'typescript' || language === 'javascript') return resolveJavaScript(specifier, importer);
      return resolver.resolveImport({ specifier }, importer, language)[0];
    },
    /** Resolves an import record from `scanModule`; Go packages and Java wildcards yield several files. */
    resolveImport(record, importer, language = 'typescript') {
      switch (language) {
        case 'python':
          return resolvePython(record, importer);
        case 'go':
          return resolveGo(record);
        case 'rust':
          return resolveRust(record, importer);
        case 'java':
          return resolveJava(record);
        default:
          return [resolveJavaScript(record.specifier, importer)];
      }
    },
    /** Config files of the root tsconfig/jsconfig `extends` chain (ROOT_ANCHOR candidates). */
    rootConfigChain() {
      const rootConfig = files.has('tsconfig.json')
        ? 'tsconfig.json'
        : files.has('jsconfig.json')
          ? 'jsconfig.json'
          : null;
      return rootConfig ? loadConfig(rootConfig).chain.filter(path => !path.includes('node_modules/')) : [];
    },
  };
  return resolver;
}
