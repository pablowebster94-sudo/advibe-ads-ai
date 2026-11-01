/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Las fuentes se leen desde node_modules en tiempo de ejecución para componer creatividades.
  outputFileTracingIncludes: {
    "/api/creative/**": ["./node_modules/@fontsource/montserrat/files/*.woff"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
