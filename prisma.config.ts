import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { resolveDatabaseUrl } from './src/lib/db-url';

// Prisma 6's migration adapter is experimental; the local SQLite client engine is GA.
// Both engines are packaged through npm, so setup needs no external engine download.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new PrismaLibSQL({ url: resolveDatabaseUrl() }),
});
