import { HookAnchorId } from '@expo/eas-build-job';
import { StepsConfigParser } from '@expo/steps';

import {
  createCustomBuildContextMock,
  createGlobalContextMock,
} from '../../__tests__/utils/context';
import { getEasFunctionGroups } from '../easFunctionGroups';
import { getEasFunctions } from '../easFunctions';

jest.mock('fs');

describe('hook anchor self-declarations', () => {
  it('exactly the four v0 functions declare anchors, with these bindings', () => {
    const declarations: Record<string, HookAnchorId> = {};
    for (const buildFunction of getEasFunctions(createCustomBuildContextMock())) {
      if (buildFunction.__hookId !== undefined) {
        declarations[buildFunction.getFullId()] = buildFunction.__hookId;
      }
    }
    // An empty declaration set must fail: without these, every user-authored
    // unstamped `uses:` step and every `eas/build` expansion loses hooks.
    expect(declarations).toEqual({
      'eas/checkout': 'checkout',
      'eas/install_node_modules': 'install_node_modules',
      'eas/upload_to_asc': 'submit',
      'eas/maestro_tests': 'maestro_tests',
    });
  });

  it('no function group id collides with a declaring function id', () => {
    // Group lookup shadows function lookup in StepsConfigParser, so a
    // collision would silently unbind the anchor.
    const declaringFunctionIds = getEasFunctions(createCustomBuildContextMock())
      .filter(buildFunction => buildFunction.__hookId !== undefined)
      .map(buildFunction => buildFunction.getFullId());
    const functionGroupIds = getEasFunctionGroups(createCustomBuildContextMock()).map(
      functionGroup => functionGroup.getFullId()
    );
    for (const functionId of declaringFunctionIds) {
      expect(functionGroupIds).not.toContain(functionId);
    }
  });

  it('attaches hooks inside a uses: eas/build expansion (declaration-driven anchor discovery)', async () => {
    // This is the guard against a semantically stale declaration — the
    // declaration existence test alone cannot catch a binding that no longer
    // corresponds to what the group actually expands to.
    const customBuildCtx = createCustomBuildContextMock();
    const globalContext = createGlobalContextMock({});
    const parser = new StepsConfigParser(globalContext, {
      steps: [{ uses: 'eas/build' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
      externalFunctions: getEasFunctions(customBuildCtx),
      externalFunctionGroups: getEasFunctionGroups(customBuildCtx),
    });
    const workflow = await parser.parseAsync();

    const installStep = workflow.buildSteps.find(step => step.__hookId === 'install_node_modules');
    expect(installStep).toBeDefined();
    const anchorHooks = workflow.hooksByAnchorStep.get(installStep!);
    expect(anchorHooks?.anchor).toBe('install_node_modules');
    expect(anchorHooks?.before[0].steps[0].id).toBe('before-hook');
    expect(anchorHooks?.after[0].steps[0].id).toBe('after-hook');
  });

  it.each([
    ['eas/checkout', 'before_checkout', 'after_checkout', undefined],
    [
      'eas/install_node_modules',
      'before_install_node_modules',
      'after_install_node_modules',
      undefined,
    ],
    [
      'eas/upload_to_asc',
      'before_submit',
      'after_submit',
      {
        ipa_path: 'app.ipa',
        asc_api_key_path: 'key.p8',
        apple_app_identifier: '1234567890',
        bundle_version: '1',
        bundle_short_version: '1.0.0',
      },
    ],
    [
      'eas/maestro_tests',
      'before_maestro_tests',
      'after_maestro_tests',
      { flow_path: ['flow.yaml'] },
    ],
  ] as const)(
    'an unstamped user-authored %s step fires its hook keys end-to-end',
    async (functionId, beforeKey, afterKey, callInputs) => {
      const customBuildCtx = createCustomBuildContextMock();
      const globalContext = createGlobalContextMock({});
      const parser = new StepsConfigParser(globalContext, {
        steps: [{ uses: functionId, ...(callInputs !== undefined ? { with: callInputs } : null) }],
        hooks: {
          [beforeKey]: [{ run: 'echo before', id: 'before-hook' }],
          [afterKey]: [{ run: 'echo after', id: 'after-hook' }],
        },
        externalFunctions: getEasFunctions(customBuildCtx),
        externalFunctionGroups: getEasFunctionGroups(customBuildCtx),
      });
      const workflow = await parser.parseAsync();
      expect(workflow.hooksByAnchorStep.size).toBe(1);
      const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
      expect(anchorHooks.before[0].steps[0].id).toBe('before-hook');
      expect(anchorHooks.after[0].steps[0].id).toBe('after-hook');
    }
  );
});
