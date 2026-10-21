/** @type {import('next').NextConfig} */
// output: "standalone" emits .next/standalone/server.js plus only the node_modules it traces,
// which the production Dockerfile copies into a small non-root image.
const nextConfig = { reactStrictMode: true, output: "standalone" };
export default nextConfig;
