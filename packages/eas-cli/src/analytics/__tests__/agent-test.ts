const detectAgentMock = jest.fn();
const logDebugMock = jest.fn();

jest.mock('agent-cli-detector', () => ({
  detectAgent: detectAgentMock,
}));

jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    debug: logDebugMock,
  },
}));

beforeEach(() => {
  jest.resetModules();
  detectAgentMock.mockReset();
  logDebugMock.mockReset();
});

it('returns detected agent telemetry context', async () => {
  detectAgentMock.mockReturnValue({
    detected: true,
    agent: { id: 'codex', name: 'Codex', sessionId: 'session-id' },
  });
  const { getAgentTelemetryContext } = await import('../agent');

  expect(getAgentTelemetryContext()).toEqual({ id: 'codex', sessionId: 'session-id' });
});

it('returns null when no known agent is detected', async () => {
  detectAgentMock.mockReturnValue({ detected: false, agent: null });
  const { getAgentTelemetryContext } = await import('../agent');

  expect(getAgentTelemetryContext()).toBeNull();
});

it('caches the detected agent telemetry context', async () => {
  detectAgentMock.mockReturnValue({
    detected: true,
    agent: { id: 'codex', name: 'Codex', sessionId: undefined },
  });
  const { getAgentTelemetryContext } = await import('../agent');

  expect(getAgentTelemetryContext()).toEqual({ id: 'codex', sessionId: undefined });
  expect(getAgentTelemetryContext()).toEqual({ id: 'codex', sessionId: undefined });
  expect(detectAgentMock).toHaveBeenCalledTimes(1);
});

it('returns null and logs debug details when detection throws', async () => {
  detectAgentMock.mockImplementation(() => {
    throw new Error('boom');
  });
  const { getAgentTelemetryContext } = await import('../agent');

  expect(getAgentTelemetryContext()).toBeNull();
  expect(logDebugMock).toHaveBeenCalledWith('Failed to detect coding agent:', 'boom');
});
