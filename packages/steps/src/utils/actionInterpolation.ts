import { Env } from '@expo/eas-build-job';

import { BuildStepContext } from '../BuildStepContext';
import { BuildStepEnv } from '../BuildStepEnv';
import { BuildConfigError } from '../errors';
import { interpolateJobContext } from '../interpolation';
import {
  BUILD_STEP_INPUT_EXPRESSION_REGEXP,
  BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX,
  interpolateStringWithInputs,
  interpolateWithOutputs,
} from './template';

const WHOLE_INPUT_EXPRESSION_REGEXP = new RegExp(`^${BUILD_STEP_INPUT_EXPRESSION_REGEXP.source}$`);

export type StepReferenceRewriter = (value: string) => string;

export function createStepReferenceRewriter(stepIdMap: Map<string, string>): StepReferenceRewriter {
  const entries = [...stepIdMap.entries()].filter(([oldId, newId]) => oldId !== newId);
  if (entries.length === 0) {
    return value => value;
  }

  entries.sort(([a], [b]) => b.length - a.length);

  const pattern = entries.map(([oldId]) => escapeRegExp(oldId)).join('|');
  const regex = new RegExp(`(?<![\\w-])steps\\.(${pattern})(?![\\w-])`, 'g');

  return value =>
    value.replace(regex, (_match, oldId: string) => `steps.${stepIdMap.get(oldId) ?? oldId}`);
}

export interface ActionInputInterpolator {
  interpolateString(value: string): string;
  interpolateValue(value: unknown): unknown;
  interpolateEnv(env: Record<string, string> | undefined): BuildStepEnv | undefined;
}

export function createActionInputInterpolator({
  inputValues,
  rewriteStepReferences,
  ref,
}: {
  inputValues: Map<string, unknown>;
  rewriteStepReferences: StepReferenceRewriter;
  ref: string;
}): ActionInputInterpolator {
  const interpolateStringField = (value: string): unknown =>
    substituteActionInputs(rewriteStepReferences(value), inputValues, ref);

  const interpolateString = (value: string): string => {
    const interpolated = interpolateStringField(value);
    return typeof interpolated === 'string' ? interpolated : stringifyInputValue(interpolated);
  };

  const interpolateValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return interpolateStringField(value);
    }
    if (Array.isArray(value)) {
      return value.map(interpolateValue);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, interpolateValue(item)])
      );
    }
    return value;
  };

  return {
    interpolateString,
    interpolateValue,
    interpolateEnv: env =>
      env &&
      Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, interpolateString(value)])
      ),
  };
}

// A whole-string input reference keeps its raw type; embedded references are stringified.
function substituteActionInputs(
  value: string,
  inputValues: Map<string, unknown>,
  ref: string
): unknown {
  const wholeMatch =
    value.match(/^\$\{\{\s*(inputs\.[\S]+)\s*\}\}$/) ?? value.match(WHOLE_INPUT_EXPRESSION_REGEXP);
  if (wholeMatch) {
    const inputName = wholeMatch[1].split('.')[1];
    if (inputValues.has(inputName)) {
      return inputValues.get(inputName);
    }
  }
  const normalized = value.replace(/\$\{\{\s*(inputs\.[\S]+)\s*\}\}/g, '${ $1 }');
  return interpolateStringWithInputs(normalized, name => {
    if (!inputValues.has(name)) {
      throw new BuildConfigError(
        `Action "${ref}" references undeclared input "${name}" in "${value}". Declare it under "inputs:" or fix the reference.`
      );
    }
    return stringifyInputValue(inputValues.get(name));
  });
}

export function resolveActionOutputTemplate(
  template: string,
  stepCtx: BuildStepContext,
  env: BuildStepEnv
): string {
  const interpolationContext = {
    ...stepCtx.global.getInterpolationContext(),
    env: env as Env,
  };
  const interpolated = interpolateJobContext({ target: template, context: interpolationContext });
  const asString =
    typeof interpolated === 'string' ? interpolated : stringifyInputValue(interpolated);
  return interpolateWithOutputs(
    stepCtx.global.interpolate(asString),
    path => stepCtx.global.getStepOutputValue(path) ?? ''
  );
}

export function isActionInputReference(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (!!BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX.exec(value) ||
      (value.startsWith('${{') && value.endsWith('}}')))
  );
}

export function mergeEnv(base?: BuildStepEnv, overrides?: BuildStepEnv): BuildStepEnv | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

export function combineIfConditions(
  inheritedIf: string | undefined,
  ownIf: string | undefined
): string | undefined {
  if (!inheritedIf) {
    return ownIf;
  }
  if (ownIf === undefined) {
    return inheritedIf;
  }
  return `\${{ (${stripIfWrapper(inheritedIf)}) && (${stripIfWrapper(ownIf)}) }}`;
}

function stripIfWrapper(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.startsWith('${{') && trimmed.endsWith('}}')) {
    return trimmed.slice(3, -2).trim();
  }
  if (trimmed.startsWith('${') && trimmed.endsWith('}')) {
    return trimmed.slice(2, -1).trim();
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringifyInputValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
