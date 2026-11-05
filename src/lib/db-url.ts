import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/** Prisma's file: paths are relative to schema.prisma, not the Node working directory. */
export function resolveDatabaseUrl(input = process.env.DATABASE_URL || 'file:./dev.db'): string {
  if (!input.startsWith('file:')) throw new Error('第一版只支援本機 SQLite file: 資料庫');
  const filePath = input.startsWith('file://') ? fileURLToPath(input) : input.slice('file:'.length);
  if (!filePath || filePath.includes('?') || filePath.includes('#')) throw new Error('SQLite 資料庫路徑不得為空或含有查詢參數');
  return pathToFileURL(path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), 'prisma', filePath)).href;
}
