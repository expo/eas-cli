export {};

const detectSandboxMock = jest.fn();
const logDebugMock = jest.fn();

jest.mock('sandbox-cli-detector', () => ({
  detectSandbox: detectSandboxMock,
}));

jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    debug: logDebugMock,
  },
}));

beforeEach(() => {
  jest.resetModules();
  detectSandboxMock.mockReset();
  logDebugMock.mockReset();
});

it('returns detected sandbox telemetry context', async () => {
  detectSandboxMock.mockReturnValue({
    detected: true,
    sandbox: { id: 'e2b', name: 'E2B' },
  });
  const { getSandboxTelemetryContext } = await import('../sandbox');

  expect(getSandboxTelemetryContext()).toBe('e2b');
});

it('returns null when no known sandbox is detected', async () => {
  detectSandboxMock.mockReturnValue({ detected: false, sandbox: null });
  const { getSandboxTelemetryContext } = await import('../sandbox');

  expect(getSandboxTelemetryContext()).toBeNull();
});

it('caches the detected sandbox telemetry context', async () => {
  detectSandboxMock.mockReturnValue({
    detected: true,
    sandbox: { id: 'e2b', name: 'E2B' },
  });
  const { getSandboxTelemetryContext } = await import('../sandbox');

  expect(getSandboxTelemetryContext()).toBe('e2b');
  expect(getSandboxTelemetryContext()).toBe('e2b');
  expect(detectSandboxMock).toHaveBeenCalledTimes(1);
});

it('returns null and logs debug details when detection throws', async () => {
  detectSandboxMock.mockImplementation(() => {
    throw new Error('boom');
  });
  const { getSandboxTelemetryContext } = await import('../sandbox');

  expect(getSandboxTelemetryContext()).toBeNull();
  expect(logDebugMock).toHaveBeenCalledWith('Failed to detect sandbox:', 'boom');
});
