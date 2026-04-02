import { StaticWorkflowInterpolationContextZ } from '../common';

describe('StaticWorkflowInterpolationContextZ', () => {
  it('accepts app and account context', () => {
    const context = {
      after: {},
      needs: {},
      workflow: {
        id: 'workflow-id',
        name: 'workflow-name',
        filename: 'workflow.yml',
        url: 'https://expo.dev/accounts/example/workflows/workflow-id',
      },
      app: {
        id: 'app-id',
        slug: 'app-slug',
      },
      account: {
        id: 'account-id',
        name: 'account-name',
      },
    };

    expect(StaticWorkflowInterpolationContextZ.parse(context)).toEqual(context);
  });

  it('accepts app_store_connect context', () => {
    const context = {
      after: {},
      needs: {},
      workflow: {
        id: 'workflow-id',
        name: 'workflow-name',
        filename: 'workflow.yml',
        url: 'https://expo.dev/accounts/example/workflows/workflow-id',
      },
      app: {
        id: 'app-id',
        slug: 'app-slug',
      },
      account: {
        id: 'account-id',
        name: 'account-name',
      },
      app_store_connect: {
        app: {
          id: '1234567890',
        },
        build_upload: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          state: 'processing',
        },
      },
    };

    expect(StaticWorkflowInterpolationContextZ.parse(context)).toEqual(context);
  });

  it('accepts app_store_connect context without build_upload', () => {
    const context = {
      after: {},
      needs: {},
      workflow: {
        id: 'workflow-id',
        name: 'workflow-name',
        filename: 'workflow.yml',
        url: 'https://expo.dev/accounts/example/workflows/workflow-id',
      },
      app: {
        id: 'app-id',
        slug: 'app-slug',
      },
      account: {
        id: 'account-id',
        name: 'account-name',
      },
      app_store_connect: {
        app: {
          id: '1234567890',
        },
      },
    };

    expect(StaticWorkflowInterpolationContextZ.parse(context)).toEqual(context);
  });

  it('rejects invalid app_store_connect build_upload context', () => {
    const context = {
      after: {},
      needs: {},
      workflow: {
        id: 'workflow-id',
        name: 'workflow-name',
        filename: 'workflow.yml',
        url: 'https://expo.dev/accounts/example/workflows/workflow-id',
      },
      app: {
        id: 'app-id',
        slug: 'app-slug',
      },
      account: {
        id: 'account-id',
        name: 'account-name',
      },
      app_store_connect: {
        app: {
          id: '1234567890',
        },
        build_upload: {
          id: 'not-a-uuid',
          state: 'invalid-state',
        },
      },
    };

    expect(() => StaticWorkflowInterpolationContextZ.parse(context)).toThrow();
  });

  it('rejects invalid app and account context', () => {
    const context = {
      after: {},
      needs: {},
      workflow: {
        id: 'workflow-id',
        name: 'workflow-name',
        filename: 'workflow.yml',
        url: 'https://expo.dev/accounts/example/workflows/workflow-id',
      },
      app: {
        id: 123,
        slug: null,
      },
      account: {
        id: null,
        name: 456,
      },
    };

    expect(() => StaticWorkflowInterpolationContextZ.parse(context)).toThrow();
  });
});

describe('GitHub context event payload passthrough', () => {
  it('accepts arbitrary fields at all event levels', () => {
    const context = {
      after: {},
      needs: {},
      github: {
        event_name: 'pull_request',
        sha: 'abc123',
        ref: 'refs/heads/main',
        ref_name: 'main',
        ref_type: 'branch',
        event: {
          action: 'opened',
          extra: { nested: true },
          label: {
            name: 'bug',
            color: 'red',
          },
          head_commit: {
            message: 'hello',
            id: 'commitsha',
            timestamp: '2024-01-01T00:00:00Z',
          },
          pull_request: {
            number: 123,
            draft: true,
          },
          number: 123,
          schedule: '0 0 * * *',
          inputs: { foo: 'bar' },
        },
      },
      workflow: {
        id: 'workflow-id',
        name: 'Workflow',
        filename: 'workflow.yml',
        url: 'https://expo.dev',
      },
      app: {
        id: 'app-id',
        slug: 'app-slug',
      },
      account: {
        id: 'account-id',
        name: 'account-name',
      },
    };

    const parsed = StaticWorkflowInterpolationContextZ.parse(context);

    expect(parsed.github?.event).toMatchObject(context.github.event);
  });
});
