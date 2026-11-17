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

// Unpacked yt-dlp build installed by scripts/postinstall.cjs (paths must match
// UNPACKED there). It starts in ~0.4s vs ~13s for the single-file build, which
// re-unpacks itself to a temp folder on every launch and gets re-scanned by the
// OS (Gatekeeper on macOS, Defender on Windows) each time.
function unpackedYtdlpPath(): string | undefined {
  if (process.platform === "darwin") return path.join(helpers.BIN_DIR, "yt-dlp_macos_unpacked", "yt-dlp_macos");
  if (process.platform === "win32") {
    const exe = { x64: "yt-dlp.exe", arm64: "yt-dlp_arm64.exe", ia32: "yt-dlp_x86.exe" }[process.arch as string];
    if (exe) return path.join(helpers.BIN_DIR, "yt-dlp_win_unpacked", exe);
  }
  return undefined;
}

export function findBinaryPath(): string | undefined {
  const unpacked = unpackedYtdlpPath();
  if (unpacked && fs.existsSync(unpacked)) return unpacked;
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
//
// Flow: one yt-dlp run dumps the video's info JSON (caption track list + title,
// channel, etc.), we pick the single best caption track in code, then download
// just that VTT over HTTP. No temp files, one track request, one page scrape.

type TranscriptErrorKind = "timeout" | "no-captions" | "network" | "blocked" | "unavailable" | "busy" | "other";

export class TranscriptError extends Error {
  constructor(public readonly kind: TranscriptErrorKind, message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

export function transcriptErrorText(videoId: string, err: unknown): string {
  if (err instanceof TranscriptError) {
    switch (err.kind) {
      case "timeout":
        return `Transcript fetch timed out for video ${videoId}. Please try again.`;
      case "no-captions":
        return err.message;
      case "network":
        return `Network error while fetching transcript for video ${videoId}. Please check your internet connection. (${err.message})`;
      case "blocked":
        return `YouTube is temporarily limiting requests for video ${videoId}. Please try again later; this usually clears within minutes but can last a few hours. Already-saved transcripts still work. (${err.message})`;
      case "unavailable":
        return `Video ${videoId} is unavailable (it may be private, removed, or age/members-restricted). (${err.message})`;
      case "busy":
        return `Too many transcript requests are queued right now, so video ${videoId} was not fetched. Please try again shortly.`;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Failed to fetch transcript for video ${videoId}: ${message}`;
}

const NETWORK_CODES = new Set([
  "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
]);

function classifyYtdlpError(stderr: string): TranscriptError {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errorLines = lines.filter((l) => l.startsWith("ERROR:"));
  const detail = (errorLines.pop() ?? lines.pop() ?? "unknown yt-dlp error")
    .replace(/^ERROR:\s*/, "")
    .replace(/\s*\(caused by [\s\S]*$/, "") // drop the Python exception chain
    .replace(/;?\s*please report this issue[\s\S]*$/i, "")
    .slice(0, 300);
  if (/HTTP Error 429|Too Many Requests|confirm you.?re not a bot/i.test(stderr)) {
    return new TranscriptError("blocked", detail);
  }
  if (/Video unavailable|video is unavailable|Private video|has been removed|This video is not available|confirm your age|members-only|join this channel/i.test(stderr)) {
    return new TranscriptError("unavailable", detail);
  }
  if (/Unable to download (webpage|API page)|urlopen error|Errno|getaddrinfo|nodename nor servname|Name or service not known|Connection (refused|reset)|Network is unreachable|timed out/i.test(stderr)) {
    return new TranscriptError("network", detail);
  }
  return new TranscriptError("other", detail);
}

function classifyFetchError(err: unknown): TranscriptError {
  const e = err as { name?: string; message?: string; cause?: { code?: string } } | undefined;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new TranscriptError("timeout", "caption download timed out");
  }
  const code = e?.cause?.code;
  if (code && NETWORK_CODES.has(code)) return new TranscriptError("network", code);
  return new TranscriptError("network", e?.message ?? String(err));
}

// ── VTT parsing ──

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Single pass, so "&amp;lt;" correctly becomes "&lt;" rather than "<".
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// WebVTT allows both HH:MM:SS.mmm and MM:SS.mmm.
const CUE_TIMING_RE = /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/;

function parseVttTime(ts: string): number {
  const parts = ts.replace(",", ".").split(":").map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return Math.round((h * 3600 + m * 60 + s) * 1000);
}

function cleanCueLine(line: string): string {
  return decodeEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// `rolling` = YouTube auto-generated captions, where every cue repeats the
// previous line and ~10ms "snapshot" cues repeat the whole visible text.
function parseVtt(content: string, rolling: boolean): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const recent: string[] = []; // last lines shown on screen (rolling dedupe)

  for (const block of content.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx === -1) continue;
    const timing = lines[timingIdx].match(CUE_TIMING_RE);
    if (!timing) continue;

    const offset = parseVttTime(timing[1]);
    const end = parseVttTime(timing[2]);
    let cueLines = lines.slice(timingIdx + 1).map(cleanCueLine).filter(Boolean);

    if (rolling) {
      cueLines = cueLines.filter((l) => !recent.includes(l));
      for (const l of cueLines) {
        recent.push(l);
        if (recent.length > 2) recent.shift();
      }
    }

    const text = cueLines.join(" ");
    if (!text) continue;
    const prev = segments[segments.length - 1];
    if (prev && prev.offset === offset && prev.text === text) continue;
    segments.push({ text, offset, duration: end - offset });
  }

  return segments;
}

// ── Track selection & download ──

interface SubtitleFormat {
  ext: string;
  url: string;
  http_headers?: Record<string, string>;
}

interface YtInfo {
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  view_count?: number;
  duration?: number;
  http_headers?: Record<string, string>;
  subtitles?: Record<string, SubtitleFormat[]>;
  automatic_captions?: Record<string, SubtitleFormat[]>;
}

interface CaptionTrack {
  lang: string;
  auto: boolean;
  format: SubtitleFormat;
}

// yt-dlp's binary can take 10s+ just to start on macOS, so allow for that.
const YTDLP_INFO_TIMEOUT_MS = 60_000;
const CAPTION_DOWNLOAD_TIMEOUT_MS = 20_000;

function fetchYtInfo(videoId: string): Promise<YtInfo> {
  const binaryPath = findBinaryPath();
  if (!binaryPath) {
    return Promise.reject(new TranscriptError("other", "yt-dlp binary not found. Try reinstalling: npm install"));
  }
  const args = buildYtdlArgs([
    `https://www.youtube.com/watch?v=${videoId}`,
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
  ]);

  // execFile's own timeout only calls back once the child has actually exited.
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      { timeout: YTDLP_INFO_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            reject(new TranscriptError("other", "yt-dlp output too large"));
          } else if (err.killed) {
            reject(new TranscriptError("timeout", "yt-dlp timed out"));
          } else {
            reject(classifyYtdlpError(stderr || err.message));
          }
          return;
        }
        try {
          resolve(JSON.parse(stdout) as YtInfo);
        } catch {
          reject(new TranscriptError("other", "could not parse yt-dlp output"));
        }
      }
    );
  });
}

// Preference: human-written subtitles (exact language, then regional variants
// like en-US), then auto-generated captions in the video's original language,
// then any other auto-generated track (e.g. auto-translated).
function pickTrack(info: YtInfo, language: string): CaptionTrack | null {
  const lang = language.toLowerCase();
  const find = (
    tracks: Record<string, SubtitleFormat[]> | undefined,
    auto: boolean,
    match: (key: string) => boolean
  ): CaptionTrack | null => {
    if (!tracks) return null;
    for (const key of Object.keys(tracks).filter((k) => match(k.toLowerCase())).sort()) {
      const format = tracks[key]?.find((f) => f.ext === "vtt" && f.url);
      if (format) return { lang: key, auto, format };
    }
    return null;
  };
  const exact = (k: string) => k === lang;
  const variant = (k: string) => k.startsWith(`${lang}-`) && !k.endsWith("-orig");
  const original = (k: string) => k === `${lang}-orig`;

  const track =
    find(info.subtitles, false, exact) ??
    find(info.subtitles, false, variant) ??
    find(info.automatic_captions, true, original) ??
    find(info.automatic_captions, true, exact) ??
    find(info.automatic_captions, true, variant);
  if (track) return track;

  // "en-US" requested but only "en" exists → fall back to the base language.
  if (lang.includes("-")) return pickTrack(info, lang.split("-")[0]);
  return null;
}

function noCaptionsError(videoId: string, language: string, info: YtInfo): TranscriptError {
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => k !== "live_chat");
  const auto = Object.keys(info.automatic_captions ?? {})
    .filter((k) => k.endsWith("-orig"))
    .map((k) => `${k.slice(0, -"-orig".length)} (auto)`);
  const available = [...manual, ...auto];
  if (available.length === 0) {
    return new TranscriptError("no-captions", `No transcript available for video ${videoId}. The video has no captions.`);
  }
  return new TranscriptError(
    "no-captions",
    `No captions in language "${language}" for video ${videoId}. Available languages: ${available.join(", ")}.`
  );
}

async function downloadTrack(track: CaptionTrack, info: YtInfo): Promise<string> {
  let res: Response;
  try {
    res = await fetch(track.format.url, {
      headers: { ...(info.http_headers ?? {}), ...(track.format.http_headers ?? {}) },
      signal: AbortSignal.timeout(CAPTION_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw classifyFetchError(err);
  }
  if (res.status === 429) throw new TranscriptError("blocked", "HTTP 429 Too Many Requests");
  if (!res.ok) throw new TranscriptError("other", `caption download failed: HTTP ${res.status}`);
  return res.text();
}

interface TranscriptData {
  segments: TranscriptSegment[];
  meta: Record<string, string>;
}

export interface TranscriptOptions {
  /** Ignore any saved copy and fetch from YouTube again (the result is still saved). */
  refresh?: boolean;
}

async function fetchTranscriptFromYoutube(videoId: string, language: string): Promise<TranscriptData> {
  const info = await fetchYtInfo(videoId);
  const track = pickTrack(info, language);
  if (!track) throw noCaptionsError(videoId, language, info);
  const segments = parseVtt(await downloadTrack(track, info), track.auto);
  if (segments.length === 0) {
    throw new TranscriptError("no-captions", `The "${track.lang}" captions for video ${videoId} are empty.`);
  }
  return { segments, meta: metadataFromInfo(info) };
}

// ── Transcript cache ──
//
// YouTube rate-limits caption downloads per IP (HTTP 429, sometimes for hours),
// and AI clients often ask about the same video several times in a row. Saved
// copies live in ~/.cache/youtube-mcp/transcripts/. Set YOUTUBE_MCP_NO_CACHE=1
// to disable.

const CACHE_DIR = path.join(os.homedir(), ".cache", "youtube-mcp", "transcripts");
const CACHE_FORMAT = 1;
const TRANSCRIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // captions rarely change
const NO_CAPTIONS_TTL_MS = 60 * 60 * 1000; // auto-captions can appear hours after upload
const CACHE_MAX_BYTES = 50 * 1024 * 1024;

type CacheEntry =
  | { format: number; savedAt: number; segments: TranscriptSegment[]; meta: Record<string, string> }
  | { format: number; savedAt: number; noCaptions: string };

function cacheEnabled(): boolean {
  const v = (process.env.YOUTUBE_MCP_NO_CACHE ?? "").toLowerCase();
  return !(v === "1" || v === "true" || v === "yes");
}

function cacheFile(videoId: string, language: string): string {
  // videoId is already validated; language is user input, so keep it to safe characters.
  const lang = language.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32) || "default";
  return path.join(CACHE_DIR, `${videoId}.${lang}.json`);
}

/** Returns the saved transcript, throws the saved "no captions" error, or returns null. */
async function readCache(videoId: string, language: string): Promise<TranscriptData | null> {
  let entry: CacheEntry;
  try {
    entry = JSON.parse(await fs.promises.readFile(cacheFile(videoId, language), "utf-8"));
  } catch {
    return null; // missing or damaged → fetch again
  }
  if (entry?.format !== CACHE_FORMAT || typeof entry.savedAt !== "number") return null;
  const age = Date.now() - entry.savedAt;
  if ("noCaptions" in entry) {
    if (age < NO_CAPTIONS_TTL_MS) throw new TranscriptError("no-captions", entry.noCaptions);
    return null;
  }
  if (age < TRANSCRIPT_TTL_MS && Array.isArray(entry.segments) && entry.segments.length > 0) {
    return { segments: entry.segments, meta: entry.meta ?? {} };
  }
  return null;
}

async function writeCache(videoId: string, language: string, entry: CacheEntry): Promise<void> {
  const file = cacheFile(videoId, language);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(entry), "utf-8");
  await fs.promises.rename(tmp, file); // atomic: readers never see a half-written file
  await pruneCache();
}

// Delete expired copies and stray temp files, then the oldest copies past the size cap.
async function pruneCache(): Promise<void> {
  const names = await fs.promises.readdir(CACHE_DIR).catch(() => [] as string[]);
  const now = Date.now();
  const kept: { file: string; size: number; mtime: number }[] = [];
  for (const name of names) {
    const file = path.join(CACHE_DIR, name);
    const st = await fs.promises.stat(file).catch(() => null);
    if (!st?.isFile()) continue;
    const expired = name.endsWith(".tmp")
      ? now - st.mtimeMs > 60 * 60 * 1000
      : name.endsWith(".json") && now - st.mtimeMs > TRANSCRIPT_TTL_MS;
    if (expired) await fs.promises.rm(file, { force: true });
    else if (name.endsWith(".json")) kept.push({ file, size: st.size, mtime: st.mtimeMs });
  }
  kept.sort((a, b) => b.mtime - a.mtime);
  let total = 0;
  for (const f of kept) {
    total += f.size;
    if (total > CACHE_MAX_BYTES) await fs.promises.rm(f.file, { force: true });
  }
}

// ── Request pacing ──
//
// Bursts are what trigger YouTube's rate limit, so at most MAX_CONCURRENT
// transcript fetches run at once (per process), with a gap between starts.

const MAX_CONCURRENT_FETCHES = 2;
const FETCH_START_GAP_MS = 1_000;
const MAX_QUEUE_WAIT_MS = 120_000;

const fetchQueue: Array<() => void> = [];
let activeFetches = 0;
let lastFetchStart = 0;
let pumpTimer: NodeJS.Timeout | null = null;

function pumpQueue(): void {
  if (pumpTimer) return;
  while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT_FETCHES) {
    const wait = lastFetchStart + FETCH_START_GAP_MS - Date.now();
    if (wait > 0) {
      pumpTimer = setTimeout(() => {
        pumpTimer = null;
        pumpQueue();
      }, wait);
      return;
    }
    activeFetches++;
    lastFetchStart = Date.now();
    fetchQueue.shift()!();
  }
}

async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const i = fetchQueue.indexOf(start);
      if (i !== -1) fetchQueue.splice(i, 1);
      reject(new TranscriptError("busy", "waited too long for a free fetch slot"));
    }, MAX_QUEUE_WAIT_MS);
    fetchQueue.push(start);
    pumpQueue();
  });
  try {
    return await fn(); // fetch timeouts only start counting here, not while queued
  } finally {
    activeFetches--;
    pumpQueue();
  }
}

// Concurrent requests for the same video+language share one fetch.
const inFlight = new Map<string, Promise<TranscriptData>>();

async function fetchTranscript(videoId: string, language: string, opts: TranscriptOptions = {}): Promise<TranscriptData> {
  const useCache = cacheEnabled();
  if (useCache && !opts.refresh) {
    const saved = await readCache(videoId, language);
    if (saved) return saved;
  }

  const key = `${videoId}|${language.toLowerCase()}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = withFetchSlot(() => fetchTranscriptFromYoutube(videoId, language))
    .then(
      async (data) => {
        if (useCache) {
          await writeCache(videoId, language, { format: CACHE_FORMAT, savedAt: Date.now(), ...data }).catch(() => {});
        }
        return data;
      },
      async (err) => {
        // Only "no captions" is remembered; rate limits and network errors are temporary.
        if (useCache && err instanceof TranscriptError && err.kind === "no-captions") {
          await writeCache(videoId, language, { format: CACHE_FORMAT, savedAt: Date.now(), noCaptions: err.message }).catch(() => {});
        }
        throw err;
      }
    )
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

function metadataFromInfo(info: YtInfo): Record<string, string> {
  const meta: Record<string, string> = {};
  if (info.title) meta.title = info.title;
  const channel = info.channel || info.uploader;
  if (channel) meta.channel = channel;
  const d = info.upload_date;
  if (d && /^\d{8}$/.test(d)) meta.publishDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (info.view_count != null) meta.viewCount = String(info.view_count);
  if (info.duration) meta.duration = formatDuration(info.duration);
  return meta;
}

// ── Public transcript API ──

const timedLine = (s: TranscriptSegment) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`;

export async function getTranscriptText(videoId: string, language = "en", opts?: TranscriptOptions): Promise<string> {
  const { segments } = await fetchTranscript(videoId, language, opts);
  return segments.map((s) => s.text).join(" ");
}

export async function getTranscriptTimed(videoId: string, language = "en", opts?: TranscriptOptions): Promise<string> {
  const { segments } = await fetchTranscript(videoId, language, opts);
  return segments.map(timedLine).join("\n");
}

export async function searchInTranscript(
  videoId: string,
  query: string,
  language = "en",
  opts?: TranscriptOptions
): Promise<string> {
  const { segments } = await fetchTranscript(videoId, language, opts);
  const lowerQuery = query.toLowerCase();
  const matches = segments.filter((s) => s.text.toLowerCase().includes(lowerQuery));
  if (matches.length === 0) return `No matches found for "${query}" in video ${videoId}.`;
  return `Found ${matches.length} match(es) for "${query}":\n\n${matches.map(timedLine).join("\n")}`;
}

export async function saveTranscriptFile(
  videoId: string,
  language = "en",
  outputDir: string,
  withTimestamps: boolean,
  opts?: TranscriptOptions
): Promise<string> {
  const { segments, meta } = await fetchTranscript(videoId, language, opts);

  const titleFromMeta = meta.title || videoId;
  const safeTitle = sanitizeTitle(titleFromMeta);
  const lines = withTimestamps ? segments.map(timedLine) : segments.map((s) => s.text);

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
