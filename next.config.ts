import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use Turbopack (default in Next.js 16).
  // @huggingface/transformers uses quantized single-threaded WASM inference which
  // does NOT require SharedArrayBuffer, so COOP/COEP headers are unnecessary
  // and harmful — they block cross-origin model/WASM file downloads from
  // HuggingFace and JSDelivr CDNs.
  turbopack: {},
};

export default nextConfig;
