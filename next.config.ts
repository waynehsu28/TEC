import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['pdfkit', '@prisma/client'], experimental: { cpus: 2 } };
export default config;
