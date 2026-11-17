#!/usr/bin/env node
// Installs the yt-dlp and FFmpeg binaries used by youtube-mcp / youtube-cli.
//
// Source of truth: packages/mcp/scripts/postinstall.cjs. `npm run build` at the
// repo root copies it to packages/cli/scripts/ — edit the mcp copy only.
//
// On macOS and Windows we install yt-dlp's official *unpacked* build (a zip of
// the program plus an _internal/ folder) instead of the single-file one. The
// single-file build unpacks itself to a fresh temp folder on every launch, and
// the OS re-scans those files each time (Gatekeeper on macOS, Defender on
// Windows): ~13s per start, much worse when several run at once. The unpacked
// build is scanned once (we trigger that here) and then starts in ~0.4s.
// It is also the only official build for Windows on ARM.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { helpers } = require("ytdlp-nodejs");

const RELEASES = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const BIN_DIR = helpers.BIN_DIR;

// Must match UNPACKED_YTDLP in packages/core/src/index.ts.
const UNPACKED = {
  darwin: {
    dir: "yt-dlp_macos_unpacked",
    builds: { x64: ["yt-dlp_macos.zip", "yt-dlp_macos"], arm64: ["yt-dlp_macos.zip", "yt-dlp_macos"] },
  },
  win32: {
    dir: "yt-dlp_win_unpacked",
    builds: {
      x64: ["yt-dlp_win.zip", "yt-dlp.exe"],
      arm64: ["yt-dlp_win_arm64.zip", "yt-dlp_arm64.exe"],
      ia32: ["yt-dlp_win_x86.zip", "yt-dlp_x86.exe"],
    },
  },
};

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function unzip(zipPath, destDir) {
  if (process.platform === "darwin") {
    execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, destDir]);
    return;
  }
  // Windows 10 (1803+) ships bsdtar, which reads zips. Use its full path so a
  // GNU tar from Git Bash (which can't) isn't picked up instead.
  const sysTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  try {
    execFileSync(sysTar, ["-xf", zipPath, "-C", destDir], { stdio: "ignore" });
  } catch {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:YT_ZIP -DestinationPath $env:YT_DEST -Force"],
      { stdio: "ignore", env: { ...process.env, YT_ZIP: zipPath, YT_DEST: destDir } },
    );
  }
}

async function installUnpacked(dirName, zipName, exeName) {
  const dir = path.join(BIN_DIR, dirName);
  const exe = path.join(dir, exeName);
  if (fs.existsSync(exe)) return exe;
  console.log(`Downloading yt-dlp (${zipName})...`);
  const [zip, sums] = await Promise.all([download(`${RELEASES}/${zipName}`), download(`${RELEASES}/SHA2-256SUMS`)]);
  const expected = sums
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === zipName)?.[0];
  if (!expected) throw new Error(`no published checksum for ${zipName}`);
  const actual = crypto.createHash("sha256").update(zip).digest("hex");
  if (actual !== expected.toLowerCase()) throw new Error(`checksum mismatch for ${zipName}`);

  const tmp = `${dir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const zipPath = path.join(tmp, zipName);
    fs.writeFileSync(zipPath, zip);
    unzip(zipPath, tmp);
    fs.rmSync(zipPath);
    const tmpExe = path.join(tmp, exeName);
    if (!fs.existsSync(tmpExe)) throw new Error(`${exeName} not found in ${zipName}`);
    if (process.platform !== "win32") fs.chmodSync(tmpExe, 0o755);
    // First launch is slow while the OS scans the new files — pay that now,
    // not on the user's first request. On macOS this has taken ~3 minutes, so
    // the limit is generous: hitting it would leave the slow build in place.
    execFileSync(tmpExe, ["--version"], { stdio: "ignore", timeout: 600_000 });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  console.log(`yt-dlp installed to: ${exe}`);
  return exe;
}

function installYtdlp() {
  const spec = UNPACKED[process.platform];
  const build = spec && spec.builds[process.arch];
  if (!build) return helpers.downloadYtDlp(BIN_DIR);
  return installUnpacked(spec.dir, ...build).catch((err) => {
    console.warn(`Could not install the fast yt-dlp build (${err.message}); using the standard one.`);
    return helpers.downloadYtDlp(BIN_DIR);
  });
}

Promise.all([installYtdlp(), helpers.downloadFFmpeg(BIN_DIR)]).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
