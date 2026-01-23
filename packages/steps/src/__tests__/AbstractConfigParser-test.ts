import path from 'path';

import { StepsConfigParser } from '../StepsConfigParser';
import { BuildFunction } from '../BuildFunction';
import { BuildConfigParser } from '../BuildConfigParser';
import { BuildStep } from '../BuildStep';

import { createGlobalContextMock } from './utils/context';
import { UUID_REGEX } from './utils/uuid';

describe('Publish Update job', () => {
  it('parses job with steps and build config to the same workflow', async () => {
    const ctx = createGlobalContextMock();
    const externalFunctions = [
      new BuildFunction({
        id: 'checkout',
        namespace: 'eas',
        fn: () => {
          console.log('checkout');
        },
      }),
      new BuildFunction({
        id: 'use_npm_token',
        namespace: 'eas',
        fn: () => {
          console.log('use_npm_token');
        },
      }),
      new BuildFunction({
        id: 'install_node_modules',
        namespace: 'eas',
        fn: () => {
          console.log('install_node_modules');
        },
      }),
    ];
    const stepsParser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: 'eas/checkout',
        },
        {
          uses: 'eas/use_npm_token',
        },
        {
          uses: 'eas/install_node_modules',
        },
        {
          name: 'Publish update',
          run: 'EXPO_TOKEN="${ eas.job.secrets.robotAccessToken }" npx -y eas-cli@latest update --auto',
        },
      ],
      externalFunctions,
    });
    const stepsResult = await stepsParser.parseAsync();
    const configParser = new BuildConfigParser(ctx, {
      configPath: path.join(__dirname, './fixtures/publish-update-job-as-config.yml'),
      externalFunctions,
    });
    const configResult = await configParser.parseAsync();
    expect(stepsResult.buildSteps.length).toEqual(configResult.buildSteps.length);
    for (let i = 0; i < stepsResult.buildSteps.length; i++) {
      assertStepsAreMatching(stepsResult.buildSteps[i], configResult.buildSteps[i]);
    }
  });
});

function assertStepsAreMatching(step1: BuildStep, step2: BuildStep): void {
  expect(step1.id).toMatch(UUID_REGEX);
  expect(step2.id).toMatch(UUID_REGEX);
  expect(step1.name).toEqual(step2.name);
  if (step1.command) {
    expect(step1.displayName).toEqual(step2.displayName);
  } else {
    expect(step1.displayName).toMatch(UUID_REGEX);
    expect(step2.displayName).toMatch(UUID_REGEX);
  }
  expect(step1.inputs).toStrictEqual(step2.inputs);
  expect(step1.outputById).toStrictEqual(step2.outputById);
  expect(step1.command?.trim()).toEqual(step2.command?.trim());
  expect(step1.fn).toEqual(step2.fn);
}
