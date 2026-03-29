import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@whiskeysockets/baileys",
    "pglite-prisma-adapter",
    "pino",
    "qrcode",
    "ws",
  ],
};

export default nextConfig;
