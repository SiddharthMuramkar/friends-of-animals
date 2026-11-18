import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // AVIF first, WebP fallback; next/image picks per the Accept header.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
