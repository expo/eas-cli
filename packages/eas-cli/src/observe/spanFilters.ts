import { AppObserveSpanKind, AppObserveSpanStatusCode } from '../graphql/generated';

export const allowedSpanKindFlagValues = Object.values(AppObserveSpanKind).map(kind =>
  kind.toLowerCase()
);

export const allowedSpanStatusFlagValues = Object.values(AppObserveSpanStatusCode).map(code =>
  code.toLowerCase()
);

export function spanKindsFromFlag(values: string[] | undefined): AppObserveSpanKind[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  return values.map(value => {
    const kind = Object.values(AppObserveSpanKind).find(k => k.toLowerCase() === value);
    if (!kind) {
      throw new Error(`Unknown span kind flag value: "${value}"`);
    }
    return kind;
  });
}

export function spanStatusCodesFromFlag(
  values: string[] | undefined
): AppObserveSpanStatusCode[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  return values.map(value => {
    const code = Object.values(AppObserveSpanStatusCode).find(c => c.toLowerCase() === value);
    if (!code) {
      throw new Error(`Unknown span status flag value: "${value}"`);
    }
    return code;
  });
}
