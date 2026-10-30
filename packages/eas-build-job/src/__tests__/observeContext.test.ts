import { ArchiveSourceType, BuildTrigger, StaticWorkflowInterpolationContextZ } from '../common';
import { Generic } from '../generic';

function createContext() {
  return {
    after: {},
    needs: {},
    workflow: {
      id: 'workflow-id',
      name: 'Investigate error',
      filename: 'observe.yml',
      url: 'https://expo.dev/accounts/example/workflows/workflow-id',
    },
    app: { id: '123e4567-e89b-42d3-a456-426614174000', slug: 'example' },
    account: { id: 'account-id', name: 'example' },
    observe: {
      event: {
        id: '123e4567-e89b-42d3-a456-426614174001',
        type: 'new_error' as const,
        occurredAt: '2026-10-29T12:00:00.000Z',
        appId: '123e4567-e89b-42d3-a456-426614174000',
        fingerprint: { value: 'error-fingerprint', version: 'v1' },
        severity: 'fatal' as const,
        environment: 'production',
        platform: 'ios' as const,
        deviceOs: 'iOS',
        exception: { type: 'Error', message: 'Example error' },
      },
    },
  };
}

describe('Observe workflow context', () => {
  it('preserves the event when validating a generic job', () => {
    const context = createContext();
    const job = {
      projectArchive: { type: ArchiveSourceType.GIT, gitCommitHash: 'abc123', gitRef: null },
      steps: [{ run: 'echo "${{ observe.event.exception.message }}"', shell: 'sh' }],
      secrets: { robotAccessToken: 'token', environmentSecrets: [] },
      expoDevUrl: context.workflow.url,
      builderEnvironment: { image: 'ubuntu', env: {} },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: context.app.id,
      initiatingUserId: '123e4567-e89b-42d3-a456-426614174002',
      workflowInterpolationContext: context,
    };

    const parsed = Generic.JobZ.parse(job);

    expect(parsed.workflowInterpolationContext).toEqual(context);
  });

  it('accepts nullable event metadata and an omitted device OS', () => {
    const context = createContext();
    const nullableContext = {
      ...context,
      observe: {
        event: {
          ...context.observe.event,
          fingerprint: { value: 'error-fingerprint', version: null },
          severity: 'error',
          environment: null,
          platform: null,
          deviceOs: undefined,
          exception: { type: null, message: null },
        },
      },
    };

    expect(StaticWorkflowInterpolationContextZ.parse(nullableContext)).toEqual(nullableContext);
  });

  it('preserves additional event fields from a newer producer', () => {
    const context = createContext();
    const extendedContext = {
      ...context,
      observe: {
        ...context.observe,
        event: {
          ...context.observe.event,
          additionalMetadata: 'future value',
          exception: { ...context.observe.event.exception, stacktrace: 'future stack trace' },
        },
      },
    };

    expect(StaticWorkflowInterpolationContextZ.parse(extendedContext)).toEqual(extendedContext);
  });

  it('rejects an Observe context without an event', () => {
    expect(
      StaticWorkflowInterpolationContextZ.safeParse({ ...createContext(), observe: {} }).success
    ).toBe(false);
  });
});
