/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle. Without this the runtime image needs
  // the whole workspace's node_modules, which for this monorepo is most of the
  // image; the traced output carries only what the pages actually import.
  output: "standalone",
  // Linting runs at the repo level; the build focuses on type-checking + compiling.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
