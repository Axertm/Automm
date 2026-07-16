import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import { createHealthApp } from '../../../src/infrastructure/http/healthServer.js';

function fakeClient(ready: boolean): Client {
  return { isReady: () => ready } as unknown as Client;
}

function fakePrisma(healthy: boolean): PrismaClient {
  return {
    $queryRaw: async () => {
      if (!healthy) throw new Error('db unreachable');
      return [{ 1: 1 }];
    },
  } as unknown as PrismaClient;
}

describe('health server', () => {
  it('GET /healthz always returns 200 (bare liveness probe)', async () => {
    const app = createHealthApp(fakeClient(false), fakePrisma(false));
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 when Discord is connected and the DB is reachable', async () => {
    const app = createHealthApp(fakeClient(true), fakePrisma(true));
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', discord: true, database: true });
  });

  it('GET /readyz returns 503 when Discord is disconnected', async () => {
    const app = createHealthApp(fakeClient(false), fakePrisma(true));
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(503);
    expect(response.body.discord).toBe(false);
  });

  it('GET /readyz returns 503 when the database is unreachable', async () => {
    const app = createHealthApp(fakeClient(true), fakePrisma(false));
    const response = await request(app).get('/readyz');
    expect(response.status).toBe(503);
    expect(response.body.database).toBe(false);
  });
});
