import path from 'node:path';

import type { LoadedAgent, LoadedConfig } from '../config/schema.js';
import type { ReviewSource } from '../sources/source.js';
import { prepareAuth } from './auth.js';
import { coordinate } from './coordinator.js';
import { writeRunLog } from './log.js';
import type { RunLogRecord } from './log.js';
import { filterNoise, writePatchWorkspace } from './noise.js';
import type { PatchWorkspaceFile } from './noise.js';
import { AgentTimeoutError, buildOpencodeConfig, promptAndParse, startOpencode } from './opencode.js';
import type { OpencodeHandle } from './opencode.js';
import { routeAgents } from './router.js';
import { buildCrossCuttingTask, buildReviewerSystem, buildReviewerTask } from './prompts.js';
import { parseReviewerOutput, SEVERITY_RANK } from './schema.js';
import type { CoordinatorOutput, Finding } from './schema.js';
import { sleep } from './util.js';

export interface ReviewRunOptions {
  config: LoadedConfig;
  mode: 'ci' | 'local';
  onProgress?: (message: string) => void;
  /** Run only these agent ids (by filename). Takes precedence over `route`. */
  agents?: string[];
  /** Let the router pick relevant agents from the diff (ignored if `agents` set). */
  route?: boolean;
}


function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * The invariant, mode-agnostic review core: filter → spawn each configured agent
 * → coordinate → apply policy. Returns a CoordinatorOutput; the CLI commands are
 * thin wrappers that supply a Source and render the result.
 */
export async function runReview(
  source: ReviewSource,
  options: ReviewRunOptions
): Promise<CoordinatorOutput> {
  const { config } = options;
  const started = Date.now();
  const runId = makeRunId();
  const progress = options.onProgress ?? (() => {});
  const runsRoot = path.join(config.configDir, '.runs');
  const runDir = path.join(runsRoot, runId);
  const logPath = path.join(runsRoot, 'reviews.jsonl');

  // Fail fast on an invalid explicit selection before doing any work. Routing
  // (if requested) is resolved later, once the server is up.
  const explicitAgents = options.agents?.length
    ? selectAgents(config.agents, options.agents)
    : null;

  const [metadata, changedFiles] = await Promise.all([
    source.getMetadata(),
    source.getChangedFiles(),
  ]);

  const { kept, filtered } = await filterNoise(changedFiles, {
    additionalIgnores: config.noise.additionalIgnores,
    additionalMarkers: config.noise.additionalMarkers,
  });
  progress(
    `${changedFiles.length} changed file(s); ${kept.length} to review, ${filtered.length} filtered.`
  );

  const baseRecord = {
    timestamp: new Date().toISOString(),
    mode: options.mode,
    runId,
    metadata: { baseRef: metadata.baseRef, headRef: metadata.headRef },
    reviewedFiles: kept.map(entry => entry.path),
    filteredFiles: filtered,
  };

  if (kept.length === 0) {
    const output: CoordinatorOutput = {
      decision: 'approve',
      findings: [],
      summary: 'No reviewable changes after noise filtering.',
      incomplete: [],
    };
    await safeLog(logPath, {
      ...baseRecord,
      agentCosts: {},
      totalCost: 0,
      durationMs: Date.now() - started,
      decision: output.decision,
      findingCount: 0,
      summary: output.summary,
    });
    return output;
  }

  const auth = await prepareAuth(config);

  progress('Starting OpenCode server…');
  let handle: OpencodeHandle | null = null;
  try {
    handle = await startOpencode(buildOpencodeConfig(config));
  } catch (error) {
    await auth.cleanup();
    throw new Error(
      `Failed to start the OpenCode server. Ensure the \`opencode\` CLI is installed and ` +
        `model credentials are configured.\n${errorMessage(error)}`
    );
  }

  const agentCosts: Record<string, number> = {};

  try {
    const workspace = await writePatchWorkspace(kept, metadata, runDir);

    // Resolve which agents run: an explicit list wins; otherwise route (LLM picks
    // relevant agents + always-run) when asked, else all.
    let selectedAgents = explicitAgents ?? config.agents;
    if (!explicitAgents && options.route) {
      progress('Routing: selecting relevant agents…');
      const routed = await routeAgents(handle!, config, workspace.files);
      selectedAgents = routed.agents;
      progress(
        routed.routed
          ? `Router selected: ${selectedAgents.map(a => a.id).join(', ')}`
          : 'Router unavailable; running all agents.'
      );
    }

    // Split the diff into focused chunks so each reviewer call sees a small file
    // set (better recall than one giant blob), and run all agent×chunk calls
    // concurrently up to a cap.
    const chunks = chunkByLines(
      workspace.files,
      config.chunk.maxChangedLines,
      config.chunk.maxFiles
    );
    // Only chunk (and add a cross-cutting pass) when the diff exceeds one chunk.
    const chunked = chunks.length > 1;
    progress(
      `Running ${selectedAgents.length} reviewer(s) [${selectedAgents.map(a => a.id).join(', ')}] over ${chunks.length} chunk(s)` +
        `${chunked ? ' + cross-cutting pass' : ''} ` +
        `(${kept.length} files, concurrency ${config.chunk.concurrency})…`
    );

    const agentFindings: Record<string, Finding[]> = {};
    for (const agent of selectedAgents) {
      agentFindings[agent.id] = [];
      agentCosts[agent.id] = 0;
    }

    interface ReviewTask {
      agent: LoadedAgent;
      label: string;
      title: string;
      text: string;
      // Per-task time ceiling. The cross-cutting pass legitimately does more work
      // (tracing across every changed file), so it gets more than a focused chunk.
      maxWaitMs: number;
    }
    const CHUNK_TIMEOUT_MS = 8 * 60 * 1000;
    const CROSS_CUTTING_TIMEOUT_MS = 15 * 60 * 1000;
    const tasks: ReviewTask[] = [];
    for (const agent of selectedAgents) {
      chunks.forEach((chunk, index) => {
        tasks.push({
          agent,
          label: chunked ? `${agent.id} [${index + 1}/${chunks.length}]` : agent.id,
          title: `review-${agent.id}-c${index}`,
          text: buildReviewerTask(chunk, workspace.files),
          maxWaitMs: CHUNK_TIMEOUT_MS,
        });
      });
      // On a large diff, one extra pass per agent looks for issues that span
      // multiple changed files, which the focused per-chunk passes can't see.
      if (chunked) {
        tasks.push({
          agent,
          label: `${agent.id} [cross-file]`,
          title: `review-${agent.id}-xcut`,
          text: buildCrossCuttingTask(workspace.files),
          maxWaitMs: CROSS_CUTTING_TIMEOUT_MS,
        });
      }
    }

    // Coverage notes for passes that hit their time limit or failed, surfaced in
    // the final review so a cut-short run is never presented as complete.
    const incomplete: string[] = [];
    const MAX_ATTEMPTS = 3;
    await mapWithConcurrency(tasks, config.chunk.concurrency, async task => {
      const minutes = Math.round(task.maxWaitMs / 60000);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { value, cost, truncated } = await promptAndParse(
            handle!,
            {
              agent: task.agent.id,
              system: buildReviewerSystem(config, task.agent),
              text: task.text,
              title: `${task.title}-a${attempt}`,
              onActivity: line => progress(`  ${task.label}: ${line}`),
              maxWaitMs: task.maxWaitMs,
              finalizeOnTimeout: true,
            },
            parseReviewerOutput
          );
          agentCosts[task.agent.id] = (agentCosts[task.agent.id] ?? 0) + cost;
          (agentFindings[task.agent.id] ??= []).push(...value.findings);
          if (truncated) {
            progress(`  ${task.label}: hit ${minutes}m limit — returned partial findings`);
            incomplete.push(
              `The \`${task.label}\` pass hit its ${minutes}-minute limit; its findings may be incomplete.`
            );
          }
          return;
        } catch (error) {
          // A timeout means the agent did not converge even after being asked to
          // wrap up. Retrying just repeats the same non-convergent run, so we
          // abandon this task rather than looping on it.
          if (error instanceof AgentTimeoutError) {
            progress(`  ${task.label}: exceeded ${minutes}m limit — skipping (no retry)`);
            incomplete.push(
              `The \`${task.label}\` pass exceeded its ${minutes}-minute limit and was skipped; it contributed no findings.`
            );
            return;
          }
          if (attempt < MAX_ATTEMPTS) {
            progress(`  ${task.label}: retrying (attempt ${attempt} failed: ${errorMessage(error)})`);
            await sleep(2000 * attempt);
          } else {
            // Give up on this task only after retries; must not sink the review.
            progress(`  ${task.label}: FAILED after ${MAX_ATTEMPTS} attempts (${errorMessage(error)})`);
            incomplete.push(
              `The \`${task.label}\` pass failed after ${MAX_ATTEMPTS} attempts; it contributed no findings.`
            );
          }
        }
      }
    });

    progress('Coordinating findings…');
    const { output: rawOutput, cost } = await coordinate(handle, config, metadata, agentFindings);
    agentCosts['coordinator'] = cost;
    const output = { ...applyReviewPolicy(rawOutput, config.policy), incomplete: [...new Set(incomplete)] };

    await safeLog(logPath, {
      ...baseRecord,
      agentCosts,
      totalCost: sum(agentCosts),
      durationMs: Date.now() - started,
      decision: output.decision,
      findingCount: output.findings.length,
      summary: output.summary,
    });

    return output;
  } catch (error) {
    await safeLog(logPath, {
      ...baseRecord,
      agentCosts,
      totalCost: sum(agentCosts),
      durationMs: Date.now() - started,
      decision: null,
      findingCount: 0,
      summary: null,
      error: errorMessage(error),
    });
    throw error;
  } finally {
    handle?.close();
    await auth.cleanup();
  }
}

/**
 * Policy backstop: drop suggestions unless opted in, cap by count (most severe
 * first), and downgrade approve_with_comments to approve when nothing remains.
 */
function applyReviewPolicy(
  output: CoordinatorOutput,
  policy: LoadedConfig['policy']
): CoordinatorOutput {
  let findings = policy.includeSuggestions
    ? output.findings
    : output.findings.filter(finding => finding.severity !== 'suggestion');
  findings = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (policy.maxFindings != null) {
    findings = findings.slice(0, policy.maxFindings);
  }
  const decision =
    output.decision === 'approve_with_comments' && findings.length === 0
      ? 'approve'
      : output.decision;
  return { ...output, findings, decision };
}

function selectAgents(all: LoadedAgent[], filter?: string[]): LoadedAgent[] {
  if (!filter?.length) {
    return all;
  }
  const known = new Set(all.map(agent => agent.id));
  const unknown = filter.filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown agent(s): ${unknown.join(', ')}. Available: ${all.map(a => a.id).join(', ')}`
    );
  }
  return all.filter(agent => filter.includes(agent.id));
}


/**
 * Greedily pack files into chunks bounded by total changed lines (primary) and
 * file count (secondary guard). A single file larger than maxChangedLines becomes
 * its own chunk (a file is never split).
 */
function chunkByLines(
  files: PatchWorkspaceFile[],
  maxChangedLines: number,
  maxFiles: number
): PatchWorkspaceFile[][] {
  const chunks: PatchWorkspaceFile[][] = [];
  let current: PatchWorkspaceFile[] = [];
  let lines = 0;
  for (const file of files) {
    const wouldOverflow = lines + file.changedLines > maxChangedLines;
    if (current.length > 0 && (wouldOverflow || current.length >= maxFiles)) {
      chunks.push(current);
      current = [];
      lines = 0;
    }
    current.push(file);
    lines += file.changedLines;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/** Run `fn` over items with at most `limit` in flight at once. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  const count = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
}

function sum(costs: Record<string, number>): number {
  return Object.values(costs).reduce((total, value) => total + value, 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeLog(logPath: string, record: RunLogRecord): Promise<void> {
  try {
    await writeRunLog(logPath, record);
  } catch {
    // Logging must never break a review.
  }
}
