import type { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';

const YAML_EXT = /\.ya?ml$/i;
const WORKSPACE_CONFIG_BASENAME = 'config.yaml';

export interface BuildFlowNameToPathMapArgs {
  inputFlowPaths: string[];
  projectRoot: string;
  logger: bunyan;
}

interface FlowEntry {
  name: string;
  path: string;
  realpath: string;
}

export async function buildFlowNameToPathMap(
  args: BuildFlowNameToPathMapArgs
): Promise<Map<string, string> | null> {
  try {
    const flows = await discoverFlows(args);
    return dedupAndDetectDuplicates(flows, args.logger);
  } catch (err: any) {
    args.logger.warn(`buildFlowNameToPathMap failed unexpectedly: ${err?.message ?? String(err)}`);
    return null;
  }
}

async function discoverFlows({
  inputFlowPaths,
  projectRoot,
  logger,
}: BuildFlowNameToPathMapArgs): Promise<FlowEntry[]> {
  const realRootResult = await asyncResult(fs.realpath(projectRoot));
  const realRoot = realRootResult.ok ? realRootResult.value : projectRoot;
  const fileLists = await Promise.all(
    inputFlowPaths.map(async input => {
      const abs = path.resolve(projectRoot, input);
      const statResult = await asyncResult(fs.stat(abs));
      if (!statResult.ok) {
        logger.warn(`flow_path entry "${input}" not found, skipping`);
        return [];
      }
      const stat = statResult.value;
      if (stat.isFile() && YAML_EXT.test(abs)) {
        return [abs];
      }
      if (stat.isDirectory()) {
        const out: string[] = [];
        await walkDir(abs, new Set(), out, logger);
        return out;
      }
      return [];
    })
  );
  return Promise.all(fileLists.flat().map(absFile => makeEntry(absFile, realRoot)));
}

async function makeEntry(absFile: string, realRoot: string): Promise<FlowEntry> {
  const [name, realFileResult] = await Promise.all([
    readFlowName(absFile),
    asyncResult(fs.realpath(absFile)),
  ]);
  const realFile = realFileResult.ok ? realFileResult.value : absFile;
  const rel = path.relative(realRoot, realFile);
  const value = rel.startsWith('..') || path.isAbsolute(rel) ? absFile : rel;
  return { name, path: value, realpath: realFile };
}

function dedupAndDetectDuplicates(flows: FlowEntry[], logger: bunyan): Map<string, string> | null {
  const byKey = new Map<string, FlowEntry>();
  for (const f of flows) {
    if (!byKey.has(f.realpath)) {
      byKey.set(f.realpath, f);
    }
  }
  const unique = [...byKey.values()];

  const nameToPath = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  for (const f of unique) {
    if (nameToPath.has(f.name)) {
      const existing = nameToPath.get(f.name)!;
      const list = duplicates.get(f.name) ?? [existing];
      list.push(f.path);
      duplicates.set(f.name, list);
    }
    nameToPath.set(f.name, f.path);
  }
  if (duplicates.size > 0) {
    for (const [name, paths] of duplicates) {
      logger.warn(`Duplicate Maestro flow name "${name}" across paths: ${paths.join(', ')}.`);
    }
    logger.warn(
      'Smart retry disabled for this run; will retry all flows on failure. ' +
        'Give each Maestro flow a unique name (file basename or top-level name) to enable smart retry.'
    );
    return null;
  }
  return nameToPath;
}

export async function walkDir(
  dir: string,
  visited: Set<string>,
  out: string[],
  logger: bunyan
): Promise<void> {
  // Cycle protection: dedup on realpath (fall back to the original path when
  // realpath fails so we still make progress on missing or restricted dirs).
  const realResult = await asyncResult(fs.realpath(dir));
  const real = realResult.ok ? realResult.value : dir;
  if (visited.has(real)) {
    return;
  }
  visited.add(real);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    logger.warn(`readdir failed for ${dir}: ${err?.message ?? String(err)}`);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const tgtResult = await asyncResult(fs.stat(full));
      if (!tgtResult.ok) {
        continue;
      }
      const tgt = tgtResult.value;
      if (tgt.isDirectory()) {
        await walkDir(full, visited, out, logger);
      } else if (tgt.isFile() && isYamlFile(entry.name) && !isWorkspaceConfig(entry.name)) {
        out.push(full);
      }
    } else if (entry.isDirectory()) {
      await walkDir(full, visited, out, logger);
    } else if (entry.isFile()) {
      if (isYamlFile(entry.name) && !isWorkspaceConfig(entry.name)) {
        out.push(full);
      }
    }
  }
}

export async function readFlowName(absFile: string): Promise<string> {
  const ext = path.extname(absFile);
  const fallback = path.basename(absFile, ext);
  let content: string;
  try {
    content = await fs.readFile(absFile, 'utf-8');
  } catch {
    return fallback;
  }

  let firstDoc;
  try {
    const docs = yaml.parseAllDocuments(content);
    firstDoc = docs[0];
  } catch {
    return fallback;
  }
  if (!firstDoc || firstDoc.errors.length > 0) {
    return fallback;
  }

  const parsed = firstDoc.toJS();
  const name = parsed?.name;
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  return fallback;
}

function isYamlFile(name: string): boolean {
  return YAML_EXT.test(name);
}

function isWorkspaceConfig(name: string): boolean {
  return name.toLowerCase() === WORKSPACE_CONFIG_BASENAME;
}
