import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ioredis", "ws", "@vercel/functions"],
  transpilePackages: ["@thebkht/rtc-file-transfer"],
  async headers() {
    return [
      {
        // The service worker must never be served stale, or a fix to it could
        // take a day to reach devices that already installed it.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
