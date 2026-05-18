#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { YoutubeTranscript } from "youtube-transcript";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import fs from "fs";
import { helpers } from "ytdlp-nodejs";

const server = new Server(
  { name: "youtube-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input: string): string | null {
  if (VIDEO_ID_RE.test(input)) {
    return input;
  }
  try {
    const url = new URL(input);
    let id: string | null = null;
    if (url.hostname === "youtu.be") {
      id = url.pathname.slice(1) || null;
    } else if (url.hostname.includes("youtube.com")) {
      id = url.searchParams.get("v");
    }
    if (id && VIDEO_ID_RE.test(id)) return id;
  } catch {}
  return null;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_transcript",
      description:
        "Fetches the transcript of a YouTube video given its URL or video ID.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The full YouTube URL or video ID (e.g. https://youtube.com/watch?v=abc123 or just abc123)",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code for the transcript (e.g. 'en', 'it'). Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_transcript_timed",
      description:
        "Fetches the transcript with timestamps for each segment.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_transcript_timestamps",
      description:
        "Fetches the transcript with timestamps for each segment. (Alias for get_transcript_timed)",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_metadata",
      description:
        "Fetches video metadata: title, channel, description, publish date, views, duration.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_video_metadata",
      description:
        "Fetches video metadata: title, channel, description, publish date, views, duration. (Alias for get_metadata)",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "search_transcript",
      description:
        "Searches for a keyword or phrase in the transcript and returns matching segments with timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          query: {
            type: "string",
            description: "The keyword or phrase to search for",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url", "query"],
      },
    },
    {
      name: "search_in_transcript",
      description:
        "Searches for a keyword or phrase in the transcript and returns matching segments with timestamps. (Alias for search_transcript)",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          query: {
            type: "string",
            description: "The keyword or phrase to search for",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url", "query"],
      },
    },
    {
      name: "download_video",
      description:
        "Downloads a YouTube video (video+audio) to the local filesystem. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          quality: {
            type: "string",
            description:
              "Optional. 'hd720' (default), 'best', 'hd1080', 'sd480', 'sd360'.",
            enum: ["best", "hd1080", "hd720", "sd480", "sd360"],
            default: "hd720",
          },
          outputDir: {
            type: "string",
            description:
              "Optional. Directory to save. Defaults to ~/Downloads.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "download_audio",
      description:
        "Downloads audio from a YouTube video. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          format: {
            type: "string",
            description:
              "Optional. Audio format: 'mp3' (default), 'm4a', 'aac', 'flac', 'opus', 'wav', 'vorbis'.",
            enum: ["mp3", "m4a", "aac", "flac", "opus", "wav", "vorbis"],
            default: "mp3",
          },
          outputDir: {
            type: "string",
            description:
              "Optional. Directory to save. Defaults to ~/Downloads.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "download_transcript",
      description:
        "Downloads the transcript of a YouTube video as a markdown file (.md). Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
          outputDir: {
            type: "string",
            description:
              "Optional. Directory to save. Defaults to ~/Downloads.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "download_transcript_timed",
      description:
        "Downloads the transcript of a YouTube video as a markdown file (.md) with timestamps. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID",
          },
          language: {
            type: "string",
            description:
              "Optional. Language code. Defaults to 'en'.",
            default: "en",
          },
          outputDir: {
            type: "string",
            description:
              "Optional. Directory to save. Defaults to ~/Downloads.",
          },
        },
        required: ["url"],
      },
    },
  ],
}));

function invalidUrlResponse(url: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Invalid YouTube URL or video ID: "${url}". Please provide a valid YouTube URL (e.g. https://youtube.com/watch?v=abc123) or a bare video ID.`,
      },
    ],
    isError: true,
  };
}

function transcriptErrorText(videoId: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  let readable = `Failed to fetch transcript for video ${videoId}: ${message}`;
  if (message.includes("Could not get transcripts")) {
    readable = `No transcript available for video ${videoId}. The video may be private, age-restricted, or have captions disabled.`;
  } else if (
    message.includes("net::") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED")
  ) {
    readable = `Network error while fetching transcript for video ${videoId}. Please check your internet connection.`;
  }
  return readable;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function fetchVideoMetadata(videoId: string) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; YoutubeMCP/1.0)" },
  });
  const html = await res.text();

  const meta: Record<string, string> = {};

  const ytInitialMatch = html.match(/window\s*\[\s*"ytInitialPlayerResponse"\s*\]\s*=\s*({.*?});/s) ||
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
    const jsonLdRegex =
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const items = data["@graph"] || [data];
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
              const stats = Array.isArray(item.interactionStatistic)
                ? item.interactionStatistic
                : [item.interactionStatistic];
              for (const stat of stats) {
                if (!meta.viewCount && stat.interactionType?.includes("WatchAction")) {
                  meta.viewCount = String(stat.userInteractionCount);
                }
              }
            }
            if (!meta.duration && item.duration) {
              const durMatch = item.duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
              if (durMatch) {
                const h = parseInt(durMatch[1]) || 0;
                const m = parseInt(durMatch[2]) || 0;
                const s = parseInt(durMatch[3]) || 0;
                meta.duration = formatDuration(h * 3600 + m * 60 + s);
              } else {
                meta.duration = item.duration;
              }
            }
          }
        }
      } catch {}
    }
  }

  const extractMeta = (attr: string, value: string): string | null => {
    const re1 = new RegExp(
      `<meta\\s+${attr}=["']${value}["']\\s+content=["']([^"']*)["']`,
      "i"
    );
    const m1 = html.match(re1);
    if (m1) return m1[1];
    const re2 = new RegExp(
      `<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${value}["']`,
      "i"
    );
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
      const durMatch = durStr.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
      if (durMatch) {
        const h = parseInt(durMatch[1]) || 0;
        const m = parseInt(durMatch[2]) || 0;
        const s = parseInt(durMatch[3]) || 0;
        meta.duration = formatDuration(h * 3600 + m * 60 + s);
      }
    }
  }

  return meta;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments || {}) as Record<string, any>;
  const url = (args.url as string) || "";
  const videoId = extractVideoId(url);

  switch (request.params.name) {
    case "get_transcript": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId, {
          lang: language,
        });
        if (!segments || segments.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transcript found for video ${videoId}.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text", text: segments.map((s: any) => s.text).join(" ") },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: transcriptErrorText(videoId, err) }],
          isError: true,
        };
      }
    }

    case "get_transcript_timed":
    case "get_transcript_timestamps": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId, {
          lang: language,
        });
        if (!segments || segments.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transcript found for video ${videoId}.`,
              },
            ],
            isError: true,
          };
        }
        const lines = segments.map(
          (s: any) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: transcriptErrorText(videoId, err) }],
          isError: true,
        };
      }
    }

    case "get_metadata":
    case "get_video_metadata": {
      if (!videoId) return invalidUrlResponse(url);
      try {
        const meta = await fetchVideoMetadata(videoId);
        const lines: string[] = [];
        if (meta.title) lines.push(`Title: ${meta.title}`);
        if (meta.channel) lines.push(`Channel: ${meta.channel}`);
        if (meta.publishDate) lines.push(`Published: ${meta.publishDate}`);
        if (meta.viewCount) lines.push(`Views: ${meta.viewCount}`);
        if (meta.duration) lines.push(`Duration: ${meta.duration}`);
        if (meta.channelUrl) lines.push(`Channel URL: ${meta.channelUrl}`);
        if (meta.channelId) lines.push(`Channel ID: ${meta.channelId}`);
        if (meta.description)
          lines.push(`Description: ${meta.description}`);
        return {
          content: [
            {
              type: "text",
              text: lines.length > 0 ? lines.join("\n") : "No metadata found.",
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text", text: `Failed to fetch metadata: ${msg}` },
          ],
          isError: true,
        };
      }
    }

    case "search_transcript":
    case "search_in_transcript": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      const query = (args.query as string) || "";
      if (!query.trim()) {
        return {
          content: [
            { type: "text", text: "Please provide a non-empty search query." },
          ],
          isError: true,
        };
      }
      try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId, {
          lang: language,
        });
        if (!segments || segments.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transcript found for video ${videoId}.`,
              },
            ],
            isError: true,
          };
        }
        const lowerQuery = query.toLowerCase();
        const matches = segments.filter((s: any) =>
          s.text.toLowerCase().includes(lowerQuery)
        );
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No matches found for "${query}" in video ${videoId}.`,
              },
            ],
          };
        }
        const lines = matches.map(
          (s: any) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${matches.length} match(es) for "${query}":\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: transcriptErrorText(videoId, err) }],
          isError: true,
        };
      }
    }

    case "download_video": {
      if (!videoId) return invalidUrlResponse(url);
      const quality = (args.quality as string) || "hd720";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return {
          content: [{ type: "text", text: `Invalid outputDir: must be within the home or temp directory.` }],
          isError: true,
        };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // vcodec^=avc1 = H.264, acodec^=mp4a = AAC — both natively supported by QuickTime
      const qualityFormatMap: Record<string, string> = {
        best: "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1]+bestaudio/best[ext=mp4]/best",
        hd1080: "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=1080]+bestaudio/best[height<=1080][ext=mp4]/best[height<=1080]",
        hd720: "bestvideo[vcodec^=avc1][height<=720]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=720]+bestaudio/best[height<=720][ext=mp4]/best[height<=720]",
        sd480: "bestvideo[vcodec^=avc1][height<=480]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=480]+bestaudio/best[height<=480][ext=mp4]/best[height<=480]",
        sd360: "bestvideo[vcodec^=avc1][height<=360]+bestaudio[acodec^=mp4a]/bestvideo[vcodec^=avc1][height<=360]+bestaudio/best[height<=360][ext=mp4]/best[height<=360]",
      };

      const binaryPath = findBinaryPath();
      if (!binaryPath) {
        return {
          content: [{ type: "text", text: "yt-dlp binary not found. Try reinstalling: npm install" }],
          isError: true,
        };
      }

      const meta = await fetchVideoMetadata(videoId).catch(() => ({} as Record<string, string>));
      const titleFromMeta = (meta as any).title || videoId;
      const safeTitle = titleFromMeta
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s*_\s*/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      const predictedPath = path.join(outputDir, `${safeTitle}.mp4`);

      const ytdlArgs = [
        videoUrl,
        "-o", path.join(outputDir, `${safeTitle}.%(ext)s`),
        "--no-warnings",
        "--merge-output-format", "mp4",
        "-f", qualityFormatMap[quality] || qualityFormatMap.hd720,
      ];

      const proc = execFile(binaryPath, buildYtdlArgs(ytdlArgs), (err, _stdout, stderr) => {
        if (err) {
          const msg = `${err.message}\n${stderr}`;
          process.stderr.write(`yt-dlp error: ${msg}\n`);
          logDownloadError(`download_video ${videoId}`, msg);
        }
      });
      proc.unref();

      return {
        content: [
          {
            type: "text",
            text: `Download started:\nTitle: ${titleFromMeta}\nThe file will appear at: ${predictedPath}\nIt may take a while for long videos.`,
          },
        ],
      };
    }

    case "download_audio": {
      if (!videoId) return invalidUrlResponse(url);
      const audioFormat = (args.format as string) || "mp3";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return {
          content: [{ type: "text", text: `Invalid outputDir: must be within the home or temp directory.` }],
          isError: true,
        };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const binaryPath = findBinaryPath();
      if (!binaryPath) {
        return {
          content: [{ type: "text", text: "yt-dlp binary not found. Try reinstalling: npm install" }],
          isError: true,
        };
      }

      const meta = await fetchVideoMetadata(videoId).catch(() => ({} as Record<string, string>));
      const titleFromMeta = (meta as any).title || videoId;
      const safeTitle = titleFromMeta
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s*_\s*/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      const predictedPath = path.join(outputDir, `${safeTitle}.${audioFormat}`);

      const ytdlArgs = [
        videoUrl,
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

      return {
        content: [
          {
            type: "text",
            text: `Download started:\nTitle: ${titleFromMeta}\nThe file will appear at: ${predictedPath}\nIt may take a while for long videos.`,
          },
        ],
      };
    }

    case "download_transcript":
    case "download_transcript_timed": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return {
          content: [{ type: "text", text: `Invalid outputDir: must be within the home or temp directory.` }],
          isError: true,
        };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      const withTimestamps = request.params.name === "download_transcript_timed";

      try {
        const [segments, meta] = await Promise.all([
          YoutubeTranscript.fetchTranscript(videoId, { lang: language }),
          fetchVideoMetadata(videoId).catch(() => ({} as Record<string, string>)),
        ]);
        if (!segments || segments.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No transcript found for video ${videoId}.`,
              },
            ],
            isError: true,
          };
        }

        const titleFromMeta = (meta as any).title || videoId;
        const safeTitle = titleFromMeta
          .replace(/[\\/:*?"<>|]/g, "_")
          .replace(/\s*_\s*/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "");

        const lines = withTimestamps
          ? segments.map((s: any) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`)
          : segments.map((s: any) => s.text);

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

        return {
          content: [
            {
              type: "text",
              text: `Transcript saved to: ${filepath}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: transcriptErrorText(videoId, err) }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
        isError: true,
      };
  }
});

const ALLOWED_OUTPUT_ROOTS = [
  os.homedir(),
  os.tmpdir(),
];

function resolveOutputDir(rawDir: string | undefined): string | null {
  const dir = rawDir ? path.resolve(rawDir) : path.join(os.homedir(), "Downloads");
  const allowed = ALLOWED_OUTPUT_ROOTS.some((root) => dir.startsWith(path.resolve(root)));
  return allowed ? dir : null;
}

const LOG_FILE = path.join(os.homedir(), ".cache", "youtube-mcp", "errors.log");

function logDownloadError(context: string, msg: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const line = `[${new Date().toISOString()}] ${context}: ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf-8");
  } catch {}
}

function findBinaryPath(): string | undefined {
  return helpers.findYtdlpBinary();
}

function buildYtdlArgs(baseArgs: string[]): string[] {
  const ffmpegPath = helpers.findFFmpegBinary();
  if (ffmpegPath) {
    return ["--ffmpeg-location", ffmpegPath, ...baseArgs];
  }
  return baseArgs;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
