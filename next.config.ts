import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pure client-side app — no server needed
  output: 'export',

  // Skip image optimization (not needed for local canvas app)
  images: { unoptimized: true },

  // Faster dev compilations
  reactStrictMode: false,
};

export default nextConfig;
