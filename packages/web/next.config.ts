import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bun:sqlite", "@fpp/db"],
};

export default nextConfig;
