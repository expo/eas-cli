import { Server } from 'http';
import request from 'supertest';

import { getWorkerVmMetrics } from '../metrics';
import { startServer } from '../metricsServer';

jest.mock('../metrics');
jest.mock('../logger');

describe('metricsServer', () => {
  let server: Server;

  beforeAll(() => {
    server = startServer();
  });

  afterAll(done => {
    server.close(done);
  });

  it('responds with metrics', async () => {
    const mockMetrics = {
      ram: { avaliableGb: 8, usedGb: 4, usagePercentage: 50 },
      cpu: { usagePercentage: 10 },
      disc: { avaliableGb: 100, usedGb: 50, usagePercentage: 50 },
    };
    jest.mocked(getWorkerVmMetrics).mockResolvedValue(mockMetrics);

    const response = await request(server).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMetrics);
  });

  it('responds with 404 for unknown routes', async () => {
    const response = await request(server).get('/unknown');
    expect(response.status).toBe(404);
  });
});
