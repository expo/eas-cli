import { promptAndParse } from './opencode.ts';
import type { OpencodeHandle } from './opencode.ts';
import { buildCoordinatorSystem, buildCoordinatorTask } from './prompts.ts';
import { parseCoordinatorOutput } from './schema.ts';
import type { CoordinatorOutput, Finding, ReviewMetadata } from './schema.ts';

export interface CoordinationResult {
  output: CoordinatorOutput;
  cost: number;
}

/**
 * Single LLM call that dedupes, re-judges severity, and decides. Structured so it
 * could later own a spawn tool, but phase 1 keeps it a plain consolidation pass.
 */
export async function coordinate(
  handle: OpencodeHandle,
  metadata: ReviewMetadata,
  agentFindings: Record<string, Finding[]>
): Promise<CoordinationResult> {
  const system = await buildCoordinatorSystem();
  const text = buildCoordinatorTask(metadata, agentFindings);
  const { value, cost } = await promptAndParse(
    handle,
    { agent: 'coordinator', system, text, title: 'review-coordinator' },
    parseCoordinatorOutput
  );
  return { output: value, cost };
}
