import mockdate from 'mockdate';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppleDistributionCertificateQuery } from '../../api/graphql/queries/AppleDistributionCertificateQuery';
import { formatDistributionCertificate } from '../DistributionCertificateUtils';
jest.mock('../../api/graphql/queries/AppleDistributionCertificateQuery');
/*
jest.mock('chalk', () => {
  return {
    __esModule: true, // this property makes it work
    default: {
      blue: jest.fn(log => log),
      gray: jest.fn(log => log),
      underline: jest.fn(log => log),
    },
  };
});
 */
jest.mock('chalk', () => ({
  red: jest.fn(text => `red(${text})`),
  blue: jest.fn(text => `blue(${text})`),
  yellow: jest.fn(text => `yellow(${text})`),
  green: jest.fn(text => `green(${text})`),
  gray: jest.fn(log => log),
  bold: jest.fn(log => log),
  dim: jest.fn(log => log),
  cyan: { bold: jest.fn(log => log) },
  underline: jest.fn(log => log),
}));

mockdate.set(new Date('4/20/2021'));
describe('select credentials', () => {
  it('select an AppleDistributionCertificate fragment', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const testDistCerts = (
      await AppleDistributionCertificateQuery.getAllForAccountAsync(graphqlClient, 'quinAccount')
    ).sort((a, b) => (a.serialNumber > b.serialNumber ? 1 : -1));
    const loggedSoFar = testDistCerts
      .map(cert => formatDistributionCertificate(cert))
      .reduce((acc, certLog) => acc + certLog);
    expect(loggedSoFar).toMatchSnapshot();
  });
});
