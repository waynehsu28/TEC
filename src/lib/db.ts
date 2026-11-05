import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { resolveDatabaseUrl } from './db-url';
export function createDb(databaseUrl?: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaLibSQL({ url: resolveDatabaseUrl(databaseUrl) }) });
}
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? createDb();
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
