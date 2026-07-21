import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { CoordinatorOutput, ReviewMetadata } from './schema.js';
import type { FilteredFile } from './noise.js';

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
