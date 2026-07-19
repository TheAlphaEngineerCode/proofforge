/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting runs at the repo level; the build focuses on type-checking + compiling.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
