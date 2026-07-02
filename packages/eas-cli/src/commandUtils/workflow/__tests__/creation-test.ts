import {
  PLACEHOLDER_WORKFLOW_CONTENTS,
  WorkflowStarterName,
  howToRunWorkflow,
  workflowStarters,
} from '../creation';

function starterFor(name: WorkflowStarterName): (typeof workflowStarters)[number] {
  const starter = workflowStarters.find(s => s.name === name);
  if (!starter) {
    throw new Error(`No starter for ${name}`);
  }
  return starter;
}

describe('workflow creation templates', () => {
  test('uses short default file names', () => {
    expect(starterFor(WorkflowStarterName.CUSTOM).defaultFileName).toBe('custom.yml');
    expect(starterFor(WorkflowStarterName.BUILD).defaultFileName).toBe('build.yml');
    expect(starterFor(WorkflowStarterName.UPDATE).defaultFileName).toBe('update.yml');
    expect(starterFor(WorkflowStarterName.DEPLOY).defaultFileName).toBe('deploy.yml');
  });

  test('development builds template has no trigger and uses the expected build profiles', () => {
    const { template } = starterFor(WorkflowStarterName.BUILD);
    expect(template.on).toBeUndefined();
    expect(template.name).toBe('Create development builds');
    expect(template.jobs).toEqual({
      android_development_build: {
        name: 'Build Android',
        type: 'build',
        params: { platform: 'android', profile: 'development' },
      },
      ios_device_development_build: {
        name: 'Build iOS device',
        type: 'build',
        params: { platform: 'ios', profile: 'development' },
      },
      ios_simulator_development_build: {
        name: 'Build iOS simulator',
        type: 'build',
        params: { platform: 'ios', profile: 'development-ios-simulator' },
      },
    });
  });

  test('publish update template has no trigger and is named "Publish update"', () => {
    const { template } = starterFor(WorkflowStarterName.UPDATE);
    expect(template.on).toBeUndefined();
    expect(template.name).toBe('Publish update');
    expect(template.jobs.publish_update).toMatchObject({
      name: 'Publish update',
      type: 'update',
    });
  });

  test('placeholder workflow contains name, on, and jobs fields', () => {
    expect(PLACEHOLDER_WORKFLOW_CONTENTS).toContain('name:');
    expect(PLACEHOLDER_WORKFLOW_CONTENTS).toContain('on:');
    expect(PLACEHOLDER_WORKFLOW_CONTENTS).toContain('jobs:');
  });
});

describe('howToRunWorkflow', () => {
  test('references the workflow file name without the .eas/workflows prefix', () => {
    const message = howToRunWorkflow('build.yml', starterFor(WorkflowStarterName.BUILD));
    expect(message).toContain('eas workflow:run build.yml');
    expect(message).not.toContain('.eas/workflows/');
  });

  test('mentions automatic triggers when the template has push branches', () => {
    const message = howToRunWorkflow('deploy.yml', starterFor(WorkflowStarterName.DEPLOY));
    expect(message).toContain('eas workflow:run deploy.yml');
    expect(message).toContain('main');
  });

  test('does not mention automatic triggers for manually-run templates', () => {
    const message = howToRunWorkflow('update.yml', starterFor(WorkflowStarterName.UPDATE));
    expect(message).toContain('eas workflow:run update.yml');
    expect(message).not.toContain('automatically');
  });
});
