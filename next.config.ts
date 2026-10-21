import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // ssh2 usa native addon — non bundlare in Turbopack
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "cpu-features"],
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
