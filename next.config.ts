import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // ホームディレクトリ等に別の lockfile が存在する環境で workspace root が
  // 誤検出されるのを防ぐため、明示的にこのプロジェクトをルートとして固定する。
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
