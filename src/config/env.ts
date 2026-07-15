import { config as loadDotenv } from 'dotenv';
import { envSchema, type Env } from './env.schema.js';

loadDotenv({ quiet: true });

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export const env: Env = loadEnv();
