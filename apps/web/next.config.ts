import path from "node:path";
import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // @loom/shared ships TypeScript, so Next compiles it rather than importing built output.
  transpilePackages: ["@loom/shared"],

  // The build runs inside apps/web but imports a workspace package two levels up.
  // Without this, file tracing stops at apps/web and leaves @loom/shared out of the bundle.
  outputFileTracingRoot: path.join(process.cwd(), "..", ".."),

  async rewrites() {
    // Proxy the Express API through Next so auth cookies are first-party and no CORS is needed.
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
