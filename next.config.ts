import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ioredis", "ws", "@vercel/functions"],
  transpilePackages: ["@thebkht/rtc-file-transfer"],
};

export default nextConfig;
