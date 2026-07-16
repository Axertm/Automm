import express, { type Express } from 'express';
import type { Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';

/**
 * The bot has no public API surface — this is the one legitimate HTTP
 * endpoint, used for container/orchestration liveness and readiness
 * checks. /healthz is a bare liveness probe (process is up). /readyz
 * additionally checks the Discord gateway connection and DB reachability.
 */
export function createHealthApp(discordClient: Client, prisma: PrismaClient): Express {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', (_req, res) => {
    void (async () => {
      const discordReady = discordClient.isReady();
      let dbReady = true;
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        dbReady = false;
      }

      const ready = discordReady && dbReady;
      res
        .status(ready ? 200 : 503)
        .json({ status: ready ? 'ok' : 'not_ready', discord: discordReady, database: dbReady });
    })();
  });

  return app;
}
