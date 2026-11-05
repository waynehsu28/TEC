import type { NextConfig } from 'next';
import { getCodespacesPreviewHost } from './src/lib/request-access';
const previewHost = getCodespacesPreviewHost();
const config: NextConfig = {
  serverExternalPackages: ['pdfkit', '@prisma/client'],
  allowedDevOrigins: previewHost ? [previewHost] : [],
  experimental: { cpus: 2 },
};
export default config;
