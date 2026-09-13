import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ioredis", "ws", "@vercel/functions"],
};

export default nextConfig;
