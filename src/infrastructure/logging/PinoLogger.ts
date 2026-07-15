import pino, { type Logger } from 'pino';
import { env } from '../../config/env.js';

// Defense-in-depth redaction: these paths are blanked automatically even if
// a caller accidentally logs a wider object than intended. The PRIMARY
// control is still the coding convention of never logging whole Wallet
// entities or raw provider responses — see CONTRIBUTING/README.
const REDACT_PATHS = [
  'privateKey',
  'encryptedPrivateKey',
  'mnemonic',
  'seed',
  'iv',
  'authTag',
  'ciphertext',
  '*.privateKey',
  '*.encryptedPrivateKey',
  '*.mnemonic',
  '*.seed',
  '*.iv',
  '*.authTag',
  '*.ciphertext',
  'req.headers.authorization',
];

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
