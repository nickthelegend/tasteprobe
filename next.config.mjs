/** @type {import('next').NextConfig} */
// output: "standalone" emits .next/standalone/server.js plus only the node_modules it traces,
// which the production Dockerfile copies into a small non-root image.
// images.unoptimized: the app uses no next/image, so /_next/image never runs the image optimizer
// (its advisories are then unreachable, whatever the Next version).
const nextConfig = { reactStrictMode: true, output: "standalone", images: { unoptimized: true } };
export default nextConfig;
