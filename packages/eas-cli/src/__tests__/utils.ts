export function asMock(fn: any): jest.Mock {
  return fn as jest.Mock;
}
