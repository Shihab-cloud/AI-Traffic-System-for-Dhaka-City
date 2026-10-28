import type { NextConfig } from 'next';
import path from 'node:path';

// Standalone output is only for the self-hosted Docker image (its Dockerfile
// sets DOCKER_BUILD=true). On Vercel this stays off so Vercel uses its own
// build pipeline untouched.
const isDockerBuild = process.env.DOCKER_BUILD === 'true';

const nextConfig: NextConfig = {
  // Dev only: no "N" dev-tools button; compile and runtime errors still pop up when they happen.
  devIndicators: false,
  ...(isDockerBuild && {
    // Self-contained server bundle for the Docker runtime.
    output: 'standalone',
    // Monorepo: trace from the repo root so the bundle includes pnpm's hoisted
    // node_modules. `next build` runs with cwd = apps/frontend, so ../.. = repo root.
    outputFileTracingRoot: path.join(process.cwd(), '../..'),
  }),
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001';
    return [
      {
        source: '/api/auth/:path*',
        destination: `${apiUrl}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
