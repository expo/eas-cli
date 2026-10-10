import { CLAUDE_CODE_CLI } from '../claude';
import { CODEX_CLI } from '../codex';
import { readFixtureLines } from './readFixture';

describe.each([
  ['Codex', CODEX_CLI, 'codex-tool-calls.jsonl'],
  ['Claude Code', CLAUDE_CODE_CLI, 'claude-code-tool-call.jsonl'],
] as const)('%s activity', (_name, cli, fixture) => {
  it('keeps tool arguments and pairs results with their calls', () => {
    const events = readFixtureLines(fixture)
      .flatMap(line => cli.formatOutputLine(line))
      .map(log => log.agentEvent);
    const calls = events.filter(event => event?.type === 'tool_call');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ arguments: { command: 'echo hi' } });
    for (const call of calls) {
      expect(events).toContainEqual({
        type: 'tool_result',
        callId: call.callId,
        text: call === calls[0] ? 'stub ran: echo hi' : 'no sandboxes',
        isError: false,
      });
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message', text: expect.any(String) })
    );
  });
});
