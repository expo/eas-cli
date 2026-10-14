import { UserError } from '@expo/eas-build-job';
import { BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

/**
 * Origins, besides the Expo website, that may embed this session's web preview in an iframe.
 * serve-sim names them in its `frame-ancestors` policy. They do not become CORS origins, so a
 * framing site can show the preview but cannot open the control socket from its own origin.
 */
export function createFrameAncestorsInputProvider(): ReturnType<
  typeof BuildStepInput.createProvider
> {
  return BuildStepInput.createProvider({
    id: 'frame_ancestors',
    required: false,
    allowedValueTypeName: BuildStepInputValueTypeName.JSON,
  });
}

/**
 * A JSON step input is whatever the workflow author wrote, so its shape has to be checked. The
 * origins themselves are checked by serve-sim, which drops any that would widen the policy.
 */
export function parseFrameAncestorsInput(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(origin => typeof origin === 'string')) {
    throw new UserError(
      'EAS_FRAME_ANCESTORS_INVALID_INPUT',
      'Input "frame_ancestors" must be an array of origins, such as ["https://example.com"].'
    );
  }
  return value;
}
