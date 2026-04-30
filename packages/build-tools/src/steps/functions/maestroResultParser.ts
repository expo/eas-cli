import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

export interface MaestroFlowResult {
  name: string;
  path: string;
  status: 'passed' | 'failed';
  errorMessage: string | null;
  duration: number; // milliseconds
  retryCount: number;
  tags: string[];
  properties: Record<string, string>;
}

// Maestro's TestDebugReporter creates timestamped directories, e.g. "2024-06-15_143022"
const TIMESTAMP_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{6}$/;

// Per-attempt JUnit XML files use `*-attempt-N.xml` names; this extracts N.
const ATTEMPT_PATTERN = /attempt-(\d+)/;

export function extractFlowKey(filename: string, prefix: string): string | null {
  const match = filename.match(new RegExp(`^${prefix}-(.+)\\.json$`));
  return match?.[1] ?? null;
}

export interface JUnitTestCaseResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number; // milliseconds
  errorMessage: string | null;
  tags: string[];
  properties: Record<string, string>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Ensure single-element arrays are always arrays
  isArray: name => ['testsuite', 'testcase', 'property'].includes(name),
});

function parseJUnitContent(content: string): JUnitTestCaseResult[] {
  const results: JUnitTestCaseResult[] = [];
  try {
    const parsed = xmlParser.parse(content);

    const testsuites = parsed?.testsuites?.testsuite;
    if (!Array.isArray(testsuites)) {
      return results;
    }

    for (const suite of testsuites) {
      const testcases = suite?.testcase;
      if (!Array.isArray(testcases)) {
        continue;
      }

      for (const tc of testcases) {
        const name = tc['@_name'];
        if (!name) {
          continue;
        }

        const timeStr = tc['@_time'];
        const timeSeconds = timeStr ? parseFloat(timeStr) : 0;
        const duration = Number.isFinite(timeSeconds) ? Math.round(timeSeconds * 1000) : 0;

        const status: 'passed' | 'failed' = tc['@_status'] === 'SUCCESS' ? 'passed' : 'failed';
        const failureText =
          tc.failure != null
            ? typeof tc.failure === 'string'
              ? tc.failure
              : (tc.failure?.['#text'] ?? null)
            : null;
        const errorText =
          tc.error != null
            ? typeof tc.error === 'string'
              ? tc.error
              : (tc.error?.['#text'] ?? null)
            : null;
        const errorMessage: string | null = failureText ?? errorText ?? null;

        const rawProperties: { '@_name': string; '@_value': string }[] =
          tc.properties?.property ?? [];
        const properties: Record<string, string> = {};
        for (const prop of rawProperties) {
          const propName = prop['@_name'];
          const value = prop['@_value'];
          if (typeof propName !== 'string' || typeof value !== 'string') {
            continue;
          }
          properties[propName] = value;
        }

        const tagsValue = properties['tags'];
        const tags: string[] = tagsValue
          ? tagsValue
              .split(',')
              .map(t => t.trim())
              .filter(Boolean)
          : [];
        delete properties['tags'];

        results.push({ name, status, duration, errorMessage, tags, properties });
      }
    }
  } catch {
    // Malformed XML — return whatever we collected before the parser bailed.
  }
  return results;
}

async function parseJUnitFile(filePath: string): Promise<JUnitTestCaseResult[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseJUnitContent(content);
  } catch {
    return [];
  }
}

export async function parseJUnitTestCases(junitDirectory: string): Promise<JUnitTestCaseResult[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(junitDirectory);
  } catch {
    return [];
  }

  const xmlFiles = entries.filter(f => f.endsWith('.xml'));
  if (xmlFiles.length === 0) {
    return [];
  }

  const perFile = await Promise.all(
    xmlFiles.map(f => parseJUnitFile(path.join(junitDirectory, f)))
  );
  return perFile.flat();
}

const FlowMetadataFileSchema = z.object({
  flow_name: z.string(),
  flow_file_path: z.string(),
});

type FlowMetadata = z.output<typeof FlowMetadataFileSchema>;

/**
 * Parses an `ai-*.json` file produced by Maestro's TestDebugReporter.
 *
 * The file contains:
 * - `flow_name`: derived from the YAML `config.name` field if present, otherwise
 *   the flow filename without extension.
 *   See: https://github.com/mobile-dev-inc/Maestro/blob/c0e95fd/maestro-cli/src/main/java/maestro/cli/runner/TestRunner.kt#L70
 * - `flow_file_path`: absolute path to the original flow YAML file.
 * - `outputs`: screenshot defect data (unused here).
 *
 * Filename format: `ai-(flowName).json` where `/` in flowName is replaced with `_`.
 * See: https://github.com/mobile-dev-inc/Maestro/blob/c0e95fd/maestro-cli/src/main/java/maestro/cli/report/TestDebugReporter.kt#L67
 */
export async function parseFlowMetadata(filePath: string): Promise<FlowMetadata | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return FlowMetadataFileSchema.parse(data);
  } catch {
    return null;
  }
}

export async function parseMaestroResults(
  junitDirectory: string,
  testsDirectory: string,
  projectRoot: string
): Promise<MaestroFlowResult[]> {
  // 1. Parse JUnit XML files, tracking which file each result came from
  let junitEntries: string[];
  try {
    junitEntries = await fs.readdir(junitDirectory);
  } catch {
    return [];
  }
  const xmlFiles = junitEntries.filter(f => f.endsWith('.xml')).sort();
  if (xmlFiles.length === 0) {
    return [];
  }

  interface JUnitResultWithSource {
    result: JUnitTestCaseResult;
    sourceFile: string;
  }

  const junitResultsWithSource: JUnitResultWithSource[] = [];
  for (const xmlFile of xmlFiles) {
    const fileResults = await parseJUnitFile(path.join(junitDirectory, xmlFile));
    for (const result of fileResults) {
      junitResultsWithSource.push({ result, sourceFile: xmlFile });
    }
  }

  if (junitResultsWithSource.length === 0) {
    return [];
  }

  // 2. Parse ai-*.json from debug output for flow_file_path + retryCount
  const flowPathMap = new Map<string, string>(); // flowName → flowFilePath
  const flowOccurrences = new Map<string, number>(); // flowName → count

  let entries: string[];
  try {
    entries = await fs.readdir(testsDirectory);
  } catch {
    entries = [];
  }

  const timestampDirs = entries.filter(name => TIMESTAMP_DIR_PATTERN.test(name)).sort();

  for (const dir of timestampDirs) {
    const dirPath = path.join(testsDirectory, dir);
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      const flowKey = extractFlowKey(file, 'ai');
      if (!flowKey) {
        continue;
      }

      const metadata = await parseFlowMetadata(path.join(dirPath, file));
      if (!metadata) {
        continue;
      }

      // Track latest path (last timestamp dir wins)
      flowPathMap.set(metadata.flow_name, metadata.flow_file_path);

      // Count occurrences for retryCount
      flowOccurrences.set(metadata.flow_name, (flowOccurrences.get(metadata.flow_name) ?? 0) + 1);
    }
  }

  // 3. Merge: JUnit results + ai-*.json metadata
  const results: MaestroFlowResult[] = [];

  // Group results by flow name
  const resultsByName = new Map<string, JUnitResultWithSource[]>();
  for (const entry of junitResultsWithSource) {
    const group = resultsByName.get(entry.result.name) ?? [];
    group.push(entry);
    resultsByName.set(entry.result.name, group);
  }

  for (const [flowName, flowEntries] of resultsByName) {
    const flowFilePath = flowPathMap.get(flowName);
    const relativePath = flowFilePath
      ? await relativizePathAsync(flowFilePath, projectRoot)
      : flowName;

    if (flowEntries.length === 1) {
      // Single result for this flow — use ai-*.json occurrence count for retryCount
      // (backward compat with old-style single JUnit file that gets overwritten)
      const { result } = flowEntries[0];
      const occurrences = flowOccurrences.get(flowName) ?? 0;
      const retryCount = Math.max(0, occurrences - 1);

      results.push({
        name: flowName,
        path: relativePath,
        status: result.status,
        errorMessage: result.errorMessage,
        duration: result.duration,
        retryCount,
        tags: result.tags,
        properties: result.properties,
      });
    } else {
      // Multiple results — per-attempt JUnit files. Sort by attempt index from filename.
      const sorted = flowEntries
        .map(entry => {
          const match = entry.sourceFile.match(ATTEMPT_PATTERN);
          const attemptIndex = match ? parseInt(match[1], 10) : 0;
          return { ...entry, attemptIndex };
        })
        .sort((a, b) => a.attemptIndex - b.attemptIndex);

      for (const { result, attemptIndex } of sorted) {
        results.push({
          name: flowName,
          path: relativePath,
          status: result.status,
          errorMessage: result.errorMessage,
          duration: result.duration,
          retryCount: attemptIndex,
          tags: result.tags,
          properties: result.properties,
        });
      }
    }
  }

  return results;
}

/**
 * Returns the subset of `inputFlowPaths` whose testcases failed in the given
 * attempt's JUnit file, or `null` when the result cannot be trusted (caller
 * then falls back to dumb retry — re-run everything).
 *
 * Mapping: <testcase> only carries `name`, so we recover `flow_file_path`
 * from `ai-${flow_name}.json` under testsDirectory and match it back to
 * inputFlowPaths.
 */
export async function parseFailedFlowsFromJUnit(args: {
  junitFile: string;
  testsDirectory: string;
  inputFlowPaths: string[];
  projectRoot: string;
}): Promise<string[] | null> {
  // fast-xml-parser is lenient — truncated XML can produce a partial parse
  // with some testcases dropped. Trusting that subset for smart retry would
  // skip retries for cut-off flows; reject any malformed XML and fall back
  // to dumb retry.
  let content: string;
  try {
    content = await fs.readFile(args.junitFile, 'utf-8');
  } catch {
    return null;
  }
  if (XMLValidator.validate(content) !== true) {
    return null;
  }

  const testcases = parseJUnitContent(content);
  if (testcases.length === 0) {
    return null;
  }

  const failing = testcases.filter(tc => tc.status === 'failed');
  if (failing.length === 0) {
    return [];
  }

  // Two testcases with the same name (pass+fail or fail+fail) make it
  // impossible to map back to a single input flow_path, since the
  // ai-*.json keyed map collapses duplicates. Signal "unknown" → dumb retry.
  const allNameCounts = new Map<string, number>();
  for (const tc of testcases) {
    allNameCounts.set(tc.name, (allNameCounts.get(tc.name) ?? 0) + 1);
  }
  for (const count of allNameCounts.values()) {
    if (count > 1) {
      return null;
    }
  }

  // Build flow_name → flow_file_path map from ai-*.json across timestamped
  // subdirectories (same traversal as parseMaestroResults).
  const nameToPath = new Map<string, string>();
  let entries: string[];
  try {
    entries = await fs.readdir(args.testsDirectory);
  } catch {
    entries = [];
  }
  const timestampDirs = entries.filter(name => TIMESTAMP_DIR_PATTERN.test(name)).sort();
  for (const dir of timestampDirs) {
    const dirPath = path.join(args.testsDirectory, dir);
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      const flowKey = extractFlowKey(file, 'ai');
      if (!flowKey) {
        continue;
      }
      const metadata = await parseFlowMetadata(path.join(dirPath, file));
      if (!metadata) {
        continue;
      }
      // Latest timestamp dir wins if the same flow appears in multiple attempts.
      nameToPath.set(metadata.flow_name, metadata.flow_file_path);
    }
  }

  const matched: string[] = [];
  for (const tc of failing) {
    const abs = nameToPath.get(tc.name);
    if (!abs) {
      return null; // unknown mapping; safer to fall back
    }
    const relative = await relativizePathAsync(abs, args.projectRoot);
    // Accept exact matches and flow files discovered under an input directory
    // (documented usage: `flow_path: ./maestro/flows` discovers nested .yml).
    // Anything outside every input is treated as out-of-scope → dumb retry.
    if (!args.inputFlowPaths.some(input => isPathWithinOrEqual(relative, input))) {
      return null;
    }
    matched.push(relative);
  }

  return matched;
}

function isPathWithinOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Reads every *.xml in sourceDir (per-attempt JUnit files), picks the latest
 * attempt's <testcase> per unique flow name (latest determined from the
 * filename's `attempt-(\d+)` marker; files without the marker = attempt 0),
 * and writes a merged document to outputPath.
 *
 * Throws on empty/malformed/no-testcase input so the caller can fall back to
 * copyLatestAttemptXml — silently dropping bad attempts could keep stale
 * failure rows around and produce a misleading merged report.
 */
export async function mergeJUnitReports(args: {
  sourceDir: string;
  outputPath: string;
}): Promise<void> {
  const entries = await fs.readdir(args.sourceDir);
  const xmlFiles = entries.filter(f => f.endsWith('.xml')).sort();

  if (xmlFiles.length === 0) {
    throw new Error(`mergeJUnitReports: no *.xml files found in ${args.sourceDir}`);
  }

  interface FileGroup {
    attemptIndex: number;
    filename: string;
    content: string;
    testcasesByName: Map<string, unknown[]>;
  }
  const contents = await Promise.all(
    xmlFiles.map(async f => ({
      filename: f,
      content: await fs.readFile(path.join(args.sourceDir, f), 'utf-8'),
    }))
  );
  const fileGroups: FileGroup[] = [];
  for (const { filename, content } of contents) {
    if (XMLValidator.validate(content) !== true) {
      throw new Error(`mergeJUnitReports: invalid XML in ${filename}`);
    }
    let parsed: any;
    try {
      parsed = xmlParser.parse(content);
    } catch (err) {
      throw new Error(`mergeJUnitReports: failed to parse ${filename}`, { cause: err });
    }
    const testsuites = parsed?.testsuites?.testsuite;
    if (!Array.isArray(testsuites)) {
      throw new Error(`mergeJUnitReports: no <testsuite> array in ${filename}`);
    }
    const match = filename.match(ATTEMPT_PATTERN);
    const attemptIndex = match ? parseInt(match[1], 10) : 0;
    const testcasesByName = new Map<string, unknown[]>();
    for (const suite of testsuites) {
      const cases = suite?.testcase;
      if (!Array.isArray(cases)) {
        continue;
      }
      for (const tc of cases) {
        const name = tc?.['@_name'];
        if (typeof name !== 'string') {
          continue;
        }
        const group = testcasesByName.get(name) ?? [];
        group.push(tc);
        testcasesByName.set(name, group);
      }
    }
    if (testcasesByName.size === 0) {
      throw new Error(`mergeJUnitReports: no parseable testcases in ${filename}`);
    }
    fileGroups.push({ attemptIndex, filename, content, testcasesByName });
  }

  // Single attempt: copy the original XML so suite-level metadata (testsuite
  // attributes, <system-out>, etc.) survives. The rebuild path below would
  // collapse those to a single attribute-less <testsuite>.
  if (fileGroups.length === 1) {
    await fs.writeFile(args.outputPath, fileGroups[0].content);
    return;
  }

  // For each unique name, pick the file with the highest attempt index that
  // contains it (ties broken by sorted filename — later wins). Preserve every
  // <testcase> element from the winning file for that name, so same-attempt
  // duplicates survive.
  const nameToWinningFile = new Map<string, FileGroup>();
  for (const group of fileGroups) {
    for (const name of group.testcasesByName.keys()) {
      const current = nameToWinningFile.get(name);
      if (!current || group.attemptIndex >= current.attemptIndex) {
        nameToWinningFile.set(name, group);
      }
    }
  }

  // Emit in first-seen order (iteration over `fileGroups` yields stable order
  // matching the sorted filename list).
  const testcases: unknown[] = [];
  const emitted = new Set<string>();
  for (const group of fileGroups) {
    for (const [name, cases] of group.testcasesByName) {
      if (emitted.has(name)) {
        continue;
      }
      const winner = nameToWinningFile.get(name);
      if (winner === group) {
        for (const tc of cases) {
          testcases.push(tc);
        }
        emitted.add(name);
      }
    }
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    suppressEmptyNode: true,
  });
  const xml = builder.build({
    testsuites: {
      testsuite: {
        testcase: testcases,
      },
    },
  });
  await fs.writeFile(args.outputPath, xml);
}

/**
 * Copies the highest-attempt-index *.xml file from sourceDir to outputPath.
 * Used as a fallback when mergeJUnitReports fails due to data issues but the
 * step still needs to produce final_report_path.
 *
 * Throws if sourceDir contains no *.xml files or if the copy fails.
 */
export async function copyLatestAttemptXml(args: {
  sourceDir: string;
  outputPath: string;
}): Promise<void> {
  const entries = await fs.readdir(args.sourceDir);
  const xmlFiles = entries.filter(f => f.endsWith('.xml')).sort();
  if (xmlFiles.length === 0) {
    throw new Error(`No *.xml files found in ${args.sourceDir}`);
  }

  // Pick the file with the highest attempt index. Files without the marker are
  // treated as attempt 0. Ties are broken by sorted filename — later wins
  // (same rule as mergeJUnitReports).
  let winner = xmlFiles[0];
  let winnerAttempt = (() => {
    const m = winner.match(ATTEMPT_PATTERN);
    return m ? parseInt(m[1], 10) : 0;
  })();
  for (let i = 1; i < xmlFiles.length; i++) {
    const candidate = xmlFiles[i];
    const match = candidate.match(ATTEMPT_PATTERN);
    const attempt = match ? parseInt(match[1], 10) : 0;
    if (attempt >= winnerAttempt) {
      winner = candidate;
      winnerAttempt = attempt;
    }
  }

  await fs.copyFile(path.join(args.sourceDir, winner), args.outputPath);
}

async function relativizePathAsync(flowFilePath: string, projectRoot: string): Promise<string> {
  if (!path.isAbsolute(flowFilePath)) {
    return flowFilePath;
  }

  // Resolve symlinks (e.g., /tmp -> /private/tmp on macOS) for consistent comparison
  let resolvedRoot = projectRoot;
  let resolvedFlow = flowFilePath;
  try {
    resolvedRoot = await fs.realpath(projectRoot);
  } catch {}
  try {
    resolvedFlow = await fs.realpath(flowFilePath);
  } catch {}

  const relative = path.relative(resolvedRoot, resolvedFlow);
  if (relative.startsWith('..')) {
    return flowFilePath;
  }
  return relative;
}
