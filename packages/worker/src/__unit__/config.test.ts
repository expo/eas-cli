function workerCapabilitiesB64(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function loadConfigFresh(): typeof import('../config').default {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../config').default;
}

describe('config capabilities (WORKER_CAPABILITIES_BASE64)', () => {
  beforeEach(() => {
    delete process.env.WORKER_CAPABILITIES_BASE64;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.WORKER_CAPABILITIES_BASE64;
    jest.resetModules();
  });

  it('defaults nestedVirtualizationEnabled to false when the env var is unset', () => {
    const config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);
  });

  it('treats empty or whitespace WORKER_CAPABILITIES_BASE64 as nested virt disabled', () => {
    process.env.WORKER_CAPABILITIES_BASE64 = '';
    let config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);

    process.env.WORKER_CAPABILITIES_BASE64 = '   \t  ';
    config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);
  });

  it('reads nested_virtualization_enabled true from base64 JSON', () => {
    process.env.WORKER_CAPABILITIES_BASE64 = workerCapabilitiesB64({
      nested_virtualization_enabled: true,
    });
    const config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(true);
  });

  it('reads nested_virtualization_enabled false from base64 JSON', () => {
    process.env.WORKER_CAPABILITIES_BASE64 = workerCapabilitiesB64({
      nested_virtualization_enabled: false,
    });
    const config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);
  });

  it('treats non-boolean nested_virtualization_enabled as false', () => {
    process.env.WORKER_CAPABILITIES_BASE64 = workerCapabilitiesB64({
      nested_virtualization_enabled: '1',
    });
    const config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);
  });

  it('treats missing nested_virtualization_enabled as false', () => {
    process.env.WORKER_CAPABILITIES_BASE64 = workerCapabilitiesB64({});
    const config = loadConfigFresh();
    expect(config.capabilities.nestedVirtualizationEnabled).toBe(false);
  });
});
