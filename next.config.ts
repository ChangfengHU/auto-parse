import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  /* config options here */
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
