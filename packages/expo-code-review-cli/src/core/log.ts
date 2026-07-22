import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { CoordinatorOutput, ReviewMetadata } from './schema.js';
import type { FilteredFile } from './noise.js';
import type { TokenUsage } from './opencode.js';

export interface RunLogRecord {
  timestamp: string;
  mode: 'ci' | 'local';
  runId: string;
  // Refs only — PR title/body are deliberately excluded to avoid persisting
  // secrets that might appear in author-controlled text.
  metadata: Pick<ReviewMetadata, 'baseRef' | 'headRef'>;
  reviewedFiles: string[];
  filteredFiles: FilteredFile[];
  agentCosts: Record<string, number>;
  totalCost: number;
  // Aggregate token usage across all agent + coordinator requests, for cache
  // metrics (cache.read/write reveal how much prompt-cache reuse we're getting).
  // Reuses TokenUsage so the log schema can't silently diverge from what's collected.
  tokens?: TokenUsage;
  durationMs: number;
  decision: CoordinatorOutput['decision'] | null;
  findingCount: number;
  summary: string | null;
  error?: string;
}

/**
 * Append one JSON line per review run. Keeps inputs, findings, decision, and
 * cost together so runs are auditable and cost/latency can be measured later.
 */
export async function writeRunLog(logPath: string, record: RunLogRecord): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}
