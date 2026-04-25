/**
 * Observability - Logging & monitoring
 * Uses Winston for structured logging to console and file
 */

import winston from 'winston';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] ${level.toUpperCase()}: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) =>
          `[${timestamp}] ${level}: ${message}`
        )
      ),
    }),
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
});

class Metrics {
  private counters = new Map<string, number>();

  record(name: string, value: number): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
    logger.debug(`metric ${name}=${value}`);
  }

  get(name: string): number {
    return this.counters.get(name) || 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

export const metrics = new Metrics();

export default logger;
