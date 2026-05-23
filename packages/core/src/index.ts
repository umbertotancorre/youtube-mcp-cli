import path from "path";
import os from "os";
import { execFile, spawn } from "child_process";
import fs from "fs";
import { helpers } from "ytdlp-nodejs";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TranscriptSegment {
  text: string;
  offset: number; // milliseconds
  duration: number;
}

// ── Video ID ──────────────────────────────────────────────────────────────────

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  if (VIDEO_ID_RE.test(input)) return input;
  try {
    const url = new URL(input);
    let id: string | null = null;
    if (url.hostname === "youtu.be") {
      id = url.pathname.slice(1).split("?")[0] || null;
    } else if (url.hostname.includes("youtube.com")) {
      const parts = url.pathname.split("/");
      if (parts[1] === "shorts" || parts[1] === "embed" || parts[1] === "v") {
        id = parts[2] || null;
      } else {
        id = url.searchParams.get("v");
      }
    }
    if (id && VIDEO_ID_RE.test(id)) return id;
  } catch {}
  return null;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function toHMS(seconds: number): [number, number, number] {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)];
}

// Padded MM:SS — used for transcript timestamps
export function formatTimestamp(seconds: number): string {
  const [h, m, s] = toHMS(seconds);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Natural M:SS — used for video duration display
export function formatDuration(seconds: number): string {
  const [h, m, s] = toHMS(seconds);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") || 0) * 3600
    + (parseInt(m[2] ?? "0") || 0) * 60
    + (parseInt(m[3] ?? "0") || 0);
}

export function sanitizeTitle(title: string): string {
  const result = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s*_\s*/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return result || "video";
}

// ── File system ───────────────────────────────────────────────────────────────

const ALLOWED_OUTPUT_ROOTS = [os.homedir(), os.tmpdir()];

export function getDownloadsDir(): string {
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DOWNLOAD_DIR;
    if (xdg && path.isAbsolute(xdg)) return xdg;
  }
  return path.join(os.homedir(), "Downloads");
}

function pathStartsWith(child: string, parent: string): boolean {
  const normalised = path.resolve(parent);
  if (process.platform === "win32") {
    return child.toLowerCase().startsWith(normalised.toLowerCase());
  }
  return child.startsWith(normalised);
}

export function resolveOutputDir(rawDir: string | undefined): string | null {
  const dir = rawDir ? path.resolve(rawDir) : getDownloadsDir();
  const allowed = ALLOWED_OUTPUT_ROOTS.some((root) => pathStartsWith(dir, root));
  return allowed ? dir : null;
}

const LOG_FILE = path.join(os.homedir(), ".cache", "youtube-mcp", "errors.log");

export function logDownloadError(context: string, msg: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${context}: ${msg}\n`, "utf-8");
  } catch {}
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────────

export function findBinaryPath(): string | undefined {
  return helpers.findYtdlpBinary();
}

export function buildYtdlArgs(baseArgs: string[]): string[] {
  const ffmpegPath = helpers.findFFmpegBinary();
  if (ffmpegPath) return ["--ffmpeg-location", ffmpegPath, ...baseArgs];
  return baseArgs;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function fetchVideoMetadata(videoId: string): Promise<Record<string, string>> {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; YoutubeMCP/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`YouTube responded with ${res.status} ${res.statusText}`);
  const html = await res.text();

  const meta: Record<string, string> = {};

  const ytInitialMatch =
    html.match(/window\s*\[\s*"ytInitialPlayerResponse"\s*\]\s*=\s*({.*?});/s) ||
    html.match(/ytInitialPlayerResponse\s*=\s*({.*?});/s);
  if (ytInitialMatch) {
    try {
      const data = JSON.parse(ytInitialMatch[1]);
      const mf = data.playerMicroformatRenderer;
      const vd = data.videoDetails;
      if (mf) {
        if (mf.title?.simpleText) meta.title = mf.title.simpleText;
        if (mf.description?.simpleText) meta.description = mf.description.simpleText;
        if (mf.ownerChannelName) meta.channel = mf.ownerChannelName;
        if (mf.publishDate) meta.publishDate = mf.publishDate;
        if (mf.viewCount) meta.viewCount = mf.viewCount;
        if (mf.lengthSeconds) meta.duration = formatDuration(Number(mf.lengthSeconds));
        if (mf.ownerProfileUrl) meta.channelUrl = mf.ownerProfileUrl;
      }
      if (vd) {
        if (!meta.title && vd.title) meta.title = vd.title;
        if (!meta.description && vd.shortDescription) meta.description = vd.shortDescription;
        if (!meta.channel && vd.author) meta.channel = vd.author;
        if (!meta.viewCount && vd.viewCount) meta.viewCount = vd.viewCount;
        if (!meta.duration && vd.lengthSeconds) meta.duration = formatDuration(Number(vd.lengthSeconds));
        if (vd.channelId) meta.channelId = vd.channelId;
        if (vd.keywords) meta.keywords = Array.isArray(vd.keywords) ? vd.keywords.join(", ") : vd.keywords;
      }
    } catch {}
  }

  if (!meta.title || !meta.description || !meta.channel || !meta.publishDate || !meta.viewCount || !meta.duration) {
    const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const items: any[] = data["@graph"] || [data];
        for (const item of items) {
          if (item["@type"] === "VideoObject" || item["@type"] === "Video") {
            if (!meta.title && item.name) meta.title = item.name;
            if (!meta.description && item.description) meta.description = item.description;
            if (!meta.channel && item.author) {
              meta.channel = typeof item.author === "string" ? item.author : item.author.name;
            }
            if (!meta.publishDate && (item.uploadDate || item.datePublished))
              meta.publishDate = item.uploadDate || item.datePublished;
            if (item.interactionStatistic) {
              const stats: any[] = Array.isArray(item.interactionStatistic)
                ? item.interactionStatistic
                : [item.interactionStatistic];
              for (const stat of stats) {
                if (!meta.viewCount && stat.interactionType?.includes("WatchAction")) {
                  meta.viewCount = String(stat.userInteractionCount);
                }
              }
            }
            if (!meta.duration && item.duration) {
              const secs = parseIsoDuration(item.duration);
              meta.duration = secs > 0 ? formatDuration(secs) : item.duration;
            }
          }
        }
      } catch {}
    }
  }

  const extractMeta = (attr: string, value: string): string | null => {
    const re1 = new RegExp(`<meta\\s+${attr}=["']${value}["']\\s+content=["']([^"']*)["']`, "i");
    const m1 = html.match(re1);
    if (m1) return m1[1];
    const re2 = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${value}["']`, "i");
    const m2 = html.match(re2);
    if (m2) return m2[1];
    return null;
  };

  if (!meta.title) meta.title = extractMeta("property", "og:title") || extractMeta("name", "twitter:title") || videoId;
  if (!meta.description) meta.description = extractMeta("property", "og:description") || extractMeta("name", "twitter:description") || "";
  if (!meta.channel) meta.channel = extractMeta("itemprop", "author") || extractMeta("name", "author") || "";
  if (!meta.publishDate) meta.publishDate = extractMeta("itemprop", "datePublished") || "";
  if (!meta.viewCount) meta.viewCount = extractMeta("itemprop", "interactionCount") || "";
  if (!meta.duration) {
    const durStr = extractMeta("itemprop", "duration") || "";
    if (durStr) {
      const secs = parseIsoDuration(durStr);
      if (secs > 0) meta.duration = formatDuration(secs);
    }
  }

  return meta;
}

// ── Transcript operations ─────────────────────────────────────────────────────

export function transcriptErrorText(videoId: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("timed out")) {
    return `Transcript fetch timed out for video ${videoId}. Please try again.`;
  }
  if (message.includes("No transcript available") || message.includes("captions")) {
    return `No transcript available for video ${videoId}. The video may not have captions.`;
  }
  if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED")) {
    return `Network error while fetching transcript for video ${videoId}. Please check your internet connection.`;
  }
  return `Failed to fetch transcript for video ${videoId}: ${message}`;
}

function parseVttTime(ts: string): number {
  const parts = ts.split(":");
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const s = parseFloat(parts[2]);
  return (h * 3600 + m * 60 + s) * 1000;
}

function parseVtt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const seen = new Set<string>();
  const blocks = content.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timingIdx = lines.findIndex((l) => l.includes(" --> "));
    if (timingIdx === -1) continue;

    const timingMatch = lines[timingIdx].match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/
    );
    if (!timingMatch) continue;

    const offset = parseVttTime(timingMatch[1]);
    const end = parseVttTime(timingMatch[2]);
    const text = lines
      .slice(timingIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;
    const key = `${offset}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    segments.push({ text, offset, duration: end - offset });
  }

  return segments;
}

async function fetchSegments(videoId: string, language: string): Promise<TranscriptSegment[]> {
  const binaryPath = findBinaryPath();
  if (!binaryPath) throw new Error("yt-dlp binary not found. Try reinstalling: npm install");

  const tmpDir = path.join(os.tmpdir(), `ytmcp-${videoId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const outputTemplate = path.join(tmpDir, "sub");
    const args = buildYtdlArgs([
      `https://www.youtube.com/watch?v=${videoId}`,
      "--skip-download",
      "--write-auto-sub",
      "--write-sub",
      "--sub-langs", `${language}.*`,
      "--sub-format", "vtt",
      "-o", outputTemplate,
      "--no-warnings",
      "--quiet",
    ]);

    await new Promise<void>((resolve, reject) => {
      const child = execFile(binaryPath, args, (err, _stdout, stderr) => {
        clearTimeout(timer);
        if (err) reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
        else resolve();
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Transcript fetch timed out"));
      }, 30_000);
    });

    const vttFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtt"));
    if (vttFiles.length === 0) {
      throw new Error(`No transcript available for video ${videoId}. The video may not have captions in language "${language}".`);
    }

    const content = fs.readFileSync(path.join(tmpDir, vttFiles[0]), "utf-8");
    const segments = parseVtt(content);
    if (segments.length === 0) throw new Error(`No transcript found for video ${videoId}.`);
    return segments;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function getTranscriptText(videoId: string, language = "en"): Promise<string> {
  const segments = await fetchSegments(videoId, language);
  return segments.map((s) => s.text).join(" ");
}

export async function getTranscriptTimed(videoId: string, language = "en"): Promise<string> {
  const segments = await fetchSegments(videoId, language);
  return segments.map((s) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`).join("\n");
}

export async function searchInTranscript(videoId: string, query: string, language = "en"): Promise<string> {
  const segments = await fetchSegments(videoId, language);
  const lowerQuery = query.toLowerCase();
  const matches = segments.filter((s) => s.text.toLowerCase().includes(lowerQuery));
  if (matches.length === 0) return `No matches found for "${query}" in video ${videoId}.`;
  const lines = matches.map((s) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`);
  return `Found ${matches.length} match(es) for "${query}":\n\n${lines.join("\n")}`;
}

export async function saveTranscriptFile(
  videoId: string,
  language = "en",
  outputDir: string,
  withTimestamps: boolean
): Promise<string> {
  const [segments, meta] = await Promise.all([
    fetchSegments(videoId, language),
    fetchVideoMetadata(videoId).catch(() => ({} as Record<string, string>)),
  ]);

  const titleFromMeta = meta.title || videoId;
  const safeTitle = sanitizeTitle(titleFromMeta);
  const lines = withTimestamps
    ? segments.map((s) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`)
    : segments.map((s) => s.text);

  const metaLines: string[] = [];
  if (meta.channel) metaLines.push(`**Channel:** ${meta.channel}`);
  if (meta.publishDate) metaLines.push(`**Published:** ${meta.publishDate}`);
  if (meta.viewCount) metaLines.push(`**Views:** ${meta.viewCount}`);
  if (meta.duration) metaLines.push(`**Duration:** ${meta.duration}`);
  metaLines.push(`**Video ID:** ${videoId}`);
  metaLines.push(`**URL:** https://www.youtube.com/watch?v=${videoId}`);

  const md = `# Transcript - ${titleFromMeta}\n\n${metaLines.join("\n")}\n\n---\n\n${lines.join(withTimestamps ? "\n" : " ")}\n`;
  const filename = `${safeTitle}${withTimestamps ? "_timed" : ""}.md`;
  const filepath = path.join(outputDir, filename);
  await fs.promises.writeFile(filepath, md, "utf-8");
  return filepath;
}

// ── Download operations ───────────────────────────────────────────────────────

const QUALITY_FORMAT_MAP: Record<string, string> = {
  best:   "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best",
  hd1080: "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=1080]+bestaudio/best[height<=1080][ext=mp4]/best[height<=1080]",
  hd720:  "bestvideo[vcodec^=avc1][height<=720]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=720]+bestaudio/best[height<=720][ext=mp4]/best[height<=720]",
  sd480:  "bestvideo[vcodec^=avc1][height<=480]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=480]+bestaudio/best[height<=480][ext=mp4]/best[height<=480]",
  sd360:  "bestvideo[vcodec^=avc1][height<=360]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=360]+bestaudio/best[height<=360][ext=mp4]/best[height<=360]",
};

async function resolveTitle(videoId: string): Promise<{ title: string; safeTitle: string }> {
  const meta = await fetchVideoMetadata(videoId).catch(() => ({} as Record<string, string>));
  const title = meta.title || videoId;
  return { title, safeTitle: sanitizeTitle(title) };
}

// Fire-and-forget — used by MCP server (returns immediately with predicted path)
export async function startVideoDownload(videoId: string, quality = "hd720", outputDir: string): Promise<string> {
  const binaryPath = findBinaryPath();
  if (!binaryPath) throw new Error("yt-dlp binary not found. Try reinstalling: npm install");

  const { title, safeTitle } = await resolveTitle(videoId);
  const predictedPath = path.join(outputDir, `${safeTitle}.mp4`);
  const ytdlArgs = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "-o", path.join(outputDir, `${safeTitle}.%(ext)s`),
    "--no-warnings",
    "--merge-output-format", "mp4",
    "-f", QUALITY_FORMAT_MAP[quality] ?? QUALITY_FORMAT_MAP.hd720,
  ];

  const proc = execFile(binaryPath, buildYtdlArgs(ytdlArgs), (err, _stdout, stderr) => {
    if (err) {
      const msg = `${err.message}\n${stderr}`;
      process.stderr.write(`yt-dlp error: ${msg}\n`);
      logDownloadError(`download_video ${videoId}`, msg);
    }
  });
  proc.unref();

  return `Download started:\nTitle: ${title}\nThe file will appear at: ${predictedPath} (extension may differ if H.264 is unavailable)\nIt may take a while for long videos.`;
}

export async function startAudioDownload(videoId: string, audioFormat = "mp3", outputDir: string): Promise<string> {
  const binaryPath = findBinaryPath();
  if (!binaryPath) throw new Error("yt-dlp binary not found. Try reinstalling: npm install");

  const { title, safeTitle } = await resolveTitle(videoId);
  const predictedPath = path.join(outputDir, `${safeTitle}.${audioFormat}`);
  const ytdlArgs = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "-o", path.join(outputDir, `${safeTitle}.%(ext)s`),
    "--no-warnings",
    "-x", "--audio-format", audioFormat, "-f", "bestaudio/best",
  ];

  const proc = execFile(binaryPath, buildYtdlArgs(ytdlArgs), (err, _stdout, stderr) => {
    if (err) {
      const msg = `${err.message}\n${stderr}`;
      process.stderr.write(`yt-dlp error: ${msg}\n`);
      logDownloadError(`download_audio ${videoId}`, msg);
    }
  });
  proc.unref();

  return `Download started:\nTitle: ${title}\nThe file will appear at: ${predictedPath}\nIt may take a while for long videos.`;
}

// Blocking — used by CLI (waits for completion, streams yt-dlp output to terminal)
function spawnYtdlp(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const binaryPath = findBinaryPath();
    if (!binaryPath) return reject(new Error("yt-dlp binary not found. Try reinstalling: npm install"));
    const proc = spawn(binaryPath, buildYtdlArgs(args), { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });
}

export function downloadVideoBlocking(videoId: string, quality = "hd720", outputDir: string): Promise<void> {
  return spawnYtdlp([
    `https://www.youtube.com/watch?v=${videoId}`,
    "-o", path.join(outputDir, "%(title)s.%(ext)s"),
    "--merge-output-format", "mp4",
    "-f", QUALITY_FORMAT_MAP[quality] ?? QUALITY_FORMAT_MAP.hd720,
  ]);
}

export function downloadAudioBlocking(videoId: string, audioFormat = "mp3", outputDir: string): Promise<void> {
  return spawnYtdlp([
    `https://www.youtube.com/watch?v=${videoId}`,
    "-o", path.join(outputDir, "%(title)s.%(ext)s"),
    "-x", "--audio-format", audioFormat, "-f", "bestaudio/best",
  ]);
}
