import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadReviewerConfig } from './config.ts';
import { coordinate } from './coordinator.ts';
import { writeRunLog } from './log.ts';
import type { RunLogRecord } from './log.ts';
import { filterNoise, writePatchWorkspace } from './noise.ts';
import type { FilteredFile } from './noise.ts';
import { promptAgent, startOpencode } from './opencode.ts';
import type { OpencodeHandle } from './opencode.ts';
import { buildReviewerSystem, buildReviewerTask } from './prompts.ts';
import { parseReviewerOutput } from './schema.ts';
import type { CoordinatorOutput, Finding } from './schema.ts';
import type { ReviewSource } from './sources/source.ts';

const REVIEWER_DIR = fileURLToPath(new URL('..', import.meta.url));

const REVIEWERS: Array<{ agent: 'correctness' | 'security' }> = [
  { agent: 'correctness' },
  { agent: 'security' },
];

export interface ReviewCoreOptions {
  mode: 'ci' | 'local';
  /** Emitted progress messages (e.g. terminal spinner text). */
  onProgress?: (message: string) => void;
  /** Override the JSONL run-log path. Defaults to <reviewer>/.runs/reviews.jsonl. */
  logPath?: string;
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * The invariant, mode-agnostic review core: filter → spawn 2 reviewers → coordinate.
 * Callable as a plain function returning CoordinatorOutput; the CLI, CI entry
 * point, and any future harness are thin wrappers over it.
 */
export async function reviewChanges(
  source: ReviewSource,
  options: ReviewCoreOptions
): Promise<CoordinatorOutput> {
  const started = Date.now();
  const runId = makeRunId();
  const progress = options.onProgress ?? (() => {});
  const runDir = path.join(REVIEWER_DIR, '.runs', runId);
  const logPath = options.logPath ?? path.join(REVIEWER_DIR, '.runs', 'reviews.jsonl');

  const [metadata, changedFiles] = await Promise.all([
    source.getMetadata(),
    source.getChangedFiles(),
  ]);

  const { kept, filtered } = filterNoise(changedFiles);
  progress(
    `${changedFiles.length} changed file(s); ${kept.length} to review, ${filtered.length} filtered.`
  );

  const baseRecord = {
    timestamp: new Date().toISOString(),
    mode: options.mode,
    runId,
    metadata,
    reviewedFiles: kept.map(entry => entry.path),
    filteredFiles: filtered,
  };

  // Nothing to review — short-circuit without spending on model calls.
  if (kept.length === 0) {
    const output: CoordinatorOutput = {
      decision: 'approve',
      findings: [],
      summary: 'No reviewable changes after noise filtering.',
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

  const config = await loadReviewerConfig();
  progress('Starting OpenCode server…');
  let handle: OpencodeHandle;
  try {
    handle = await startOpencode(config);
  } catch (error) {
    throw new Error(
      `Failed to start the OpenCode server. Ensure model credentials are configured ` +
        `(see OpenCode auth / your provider env vars).\n${errorMessage(error)}`
    );
  }

  const agentCosts: Record<string, number> = {};

  try {
    const workspace = await writePatchWorkspace(kept, metadata, runDir);

    progress('Running correctness and security reviewers…');
    const reviewerResults = await Promise.all(
      REVIEWERS.map(async ({ agent }) => {
        const system = await buildReviewerSystem(agent);
        const task = buildReviewerTask(workspace);
        const result = await promptAgent(handle, {
          agent,
          system,
          text: task,
          title: `review-${agent}`,
        });
        agentCosts[agent] = result.cost;
        return { agent, findings: parseReviewerOutput(result.text).findings };
      })
    );

    const agentFindings: Record<string, Finding[]> = {};
    for (const { agent, findings } of reviewerResults) {
      agentFindings[agent] = findings;
    }

    progress('Coordinating findings…');
    const { output, cost } = await coordinate(handle, metadata, agentFindings);
    agentCosts['coordinator'] = cost;

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
    handle.close();
  }
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

export type { FilteredFile };
