import { getAndroidApiMock } from '../__tests__/fixtures-android';
import { createCtxMock } from '../__tests__/fixtures-context';

export const createCredentialsContextAsync = () =>
  createCtxMock({
    android: getAndroidApiMock(),
  });
