import { CLAUDE_CODE_CLI } from '../claude';
import { CODEX_CLI } from '../codex';
import { readFixtureLines } from './readFixture';

describe.each([
  ['Codex', CODEX_CLI, 'codex-tool-calls.jsonl', ['item_0', 'item_3']],
  ['Claude Code', CLAUDE_CODE_CLI, 'claude-code-tool-call.jsonl', ['msg_002']],
] as const)('%s activity', (_name, cli, fixture, messageIds) => {
  it('keeps tool arguments and pairs results with their calls', () => {
    const events = readFixtureLines(fixture)
      .flatMap(line => cli.formatOutputLine(line))
      .flatMap(log => log.agentEvent?.content ?? []);
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
    expect(events.filter(event => event?.type === 'message').map(event => event.messageId)).toEqual(
      messageIds
    );
  });
});

it('marks a Codex tool result as failed when the server returned an error in its content', () => {
  expect(
    CODEX_CLI.formatOutputLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'mcp_tool_call',
          server: 'expo',
          tool: 'sandbox_list',
          arguments: {},
          status: 'failed',
          error: null,
          result: { content: [{ type: 'text', text: 'Network connection lost.' }] },
        },
      })
    )
  ).toEqual([
    {
      level: 'warn',
      message: 'Tool error: Network connection lost.',
      agentEvent: {
        producer: 'codex',
        content: [
          {
            type: 'tool_result',
            callId: 'item_1',
            text: 'Network connection lost.',
            isError: true,
          },
        ],
      },
    },
  ]);
});

// A provider can report a recoverable error before it finishes the same invocation.
it.each([
  [CODEX_CLI, { type: 'error', message: 'Retrying.' }, 'warning'],
  [CODEX_CLI, { type: 'item.completed', item: { type: 'error', message: 'Retrying.' } }, 'warning'],
  [CODEX_CLI, { type: 'turn.failed', error: { message: 'Stopped.' } }, 'error'],
  [
    CLAUDE_CODE_CLI,
    { type: 'system', subtype: 'init', mcp_servers: [{ name: 'expo', status: 'failed' }] },
    'warning',
  ],
  [
    CLAUDE_CODE_CLI,
    { type: 'result', subtype: 'error', is_error: true, result: 'Stopped.' },
    'error',
  ],
] as const)('keeps error severity in the structured event (%j, %j)', (cli, input, severity) => {
  expect(cli.formatOutputLine(JSON.stringify(input))[0]?.agentEvent?.content[0]).toMatchObject({
    type: 'error',
    severity,
  });
});

it('keeps all text blocks of a Claude message under the provider message ID', () => {
  const events = CLAUDE_CODE_CLI.formatOutputLine(
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_123',
        content: [
          { type: 'text', text: 'First.' },
          { type: 'text', text: 'Second.' },
        ],
      },
    })
  ).flatMap(log => log.agentEvent?.content ?? []);
  expect(events).toEqual([
    { type: 'message', messageId: 'msg_123', text: 'First.' },
    { type: 'message', messageId: 'msg_123', text: 'Second.' },
  ]);
});

// Source fields must not be copied into the shared event.
it.each([
  ['Claude Code', CLAUDE_CODE_CLI, 'claude-code-tool-call.jsonl', 3],
  ['Codex', CODEX_CLI, 'codex-tool-calls.jsonl', 6],
] as const)(
  'keeps only typed activity without source data for %s',
  (_name, cli, fixture, count) => {
    const events = readFixtureLines(fixture).flatMap(line => {
      const source = { ...JSON.parse(line), futureField: { image: 'base64-image-payload' } };
      return cli
        .formatOutputLine(JSON.stringify(source))
        .flatMap(log => (log.agentEvent ? [log.agentEvent] : []));
    });
    expect(events).toHaveLength(count);
    for (const event of events) {
      expect(event.content.length).toBeGreaterThan(0);
      expect(event).not.toHaveProperty('data');
    }
    expect(JSON.stringify(events)).not.toContain('base64-image-payload');
  }
);

it('groups a Claude message with mixed content in one shared event', () => {
  const source = {
    type: 'assistant',
    message: {
      id: 'msg_123',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_1', name: 'check', input: { path: '/' } },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'base64-image-payload' },
        },
      ],
    },
  };
  const events = CLAUDE_CODE_CLI.formatOutputLine(JSON.stringify(source)).flatMap(log =>
    log.agentEvent ? [log.agentEvent] : []
  );
  expect(events).toEqual([
    {
      producer: 'claude-code',
      content: [
        { type: 'message', messageId: 'msg_123', text: 'Checking.' },
        { type: 'tool_call', callId: 'toolu_1', name: 'check', arguments: { path: '/' } },
      ],
    },
  ]);
});
