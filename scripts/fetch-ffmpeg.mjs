#!/usr/bin/env node
/**
 * 下載 FFmpeg（LGPL、shared 版）到 src-tauri/bin/，打包時會一起放進安裝檔。
 * 來源：https://github.com/BtbN/FFmpeg-Builds
 *
 * 已存在就跳過；加上 --force 可重新下載。
 * 要更新版本時修改 FFMPEG_BRANCH。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG_BRANCH = "8.1";
const ASSET = `ffmpeg-n${FFMPEG_BRANCH}-latest-win64-lgpl-shared-${FFMPEG_BRANCH}.zip`;
const RELEASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "bin");
const force = process.argv.includes("--force");

if (process.platform !== "win32") {
  console.log("[fetch-ffmpeg] 目前只處理 Windows，略過");
  process.exit(0);
}
if (!force && existsSync(join(binDir, "ffmpeg.exe")) && existsSync(join(binDir, "ffprobe.exe"))) {
  console.log("[fetch-ffmpeg] src-tauri/bin 已有 FFmpeg，略過（--force 可重新下載）");
  process.exit(0);
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`下載失敗 ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`[fetch-ffmpeg] 下載 ${ASSET} …`);
const [zip, checksums] = await Promise.all([
  download(`${RELEASE}/${ASSET}`),
  download(`${RELEASE}/checksums.sha256`).then((b) => b.toString("utf8")),
]);

const expected = checksums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name?.replace(/^\*/, "") === ASSET)?.[0];
const actual = createHash("sha256").update(zip).digest("hex");
if (!expected) throw new Error(`checksums.sha256 裡找不到 ${ASSET}`);
if (expected !== actual) throw new Error(`SHA-256 不符：預期 ${expected}，實際 ${actual}`);
console.log("[fetch-ffmpeg] SHA-256 驗證通過");

// 解壓到獨立的暫存資料夾（Windows 10+ 內建的 tar 支援 zip）
const work = mkdtempSync(join(tmpdir(), "fetch-ffmpeg-"));
try {
  const zipPath = join(work, ASSET);
  writeFileSync(zipPath, zip);
  const extractDir = join(work, "out");
  mkdirSync(extractDir);
  execFileSync("tar", ["-xf", zipPath, "-C", extractDir], { stdio: "inherit" });

  const top = join(extractDir, readdirSync(extractDir)[0] ?? "");
  const srcBin = join(top, "bin");

  rmSync(binDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  // 只需要 ffmpeg、ffprobe 與共用的 DLL，不需要 ffplay
  for (const file of readdirSync(srcBin)) {
    if (file === "ffmpeg.exe" || file === "ffprobe.exe" || file.endsWith(".dll")) {
      copyFileSync(join(srcBin, file), join(binDir, file));
    }
  }
  // LGPL 要求隨程式附上授權條款
  copyFileSync(join(top, "LICENSE.txt"), join(binDir, "FFMPEG-LICENSE.txt"));

  console.log(`[fetch-ffmpeg] 完成：${readdirSync(binDir).join(", ")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
