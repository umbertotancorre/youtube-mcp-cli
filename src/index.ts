import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { YoutubeTranscript } from "youtube-transcript";

const server = new Server(
  { name: "youtube-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function extractVideoId(input: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1) || null;
    }
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v");
    }
  } catch {}
  return null;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
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
      name: "get_transcript_timestamps",
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
      name: "get_video_metadata",
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
      name: "search_in_transcript",
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

async function fetchVideoMetadata(videoId: string) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; YoutubeMCP/1.0)" },
  });
  const html = await res.text();

  const jsonLdRegex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = data["@graph"] || [data];
      for (const item of items) {
        if (item["@type"] === "VideoObject" || item["@type"] === "Video") {
          const meta: Record<string, string> = {};
          if (item.name) meta.title = item.name;
          if (item.description) meta.description = item.description;
          if (item.author) {
            meta.channel =
              typeof item.author === "string"
                ? item.author
                : item.author.name;
          }
          if (item.uploadDate || item.datePublished)
            meta.publishDate = item.uploadDate || item.datePublished;
          if (item.duration) meta.duration = item.duration;
          if (item.interactionStatistic) {
            const stats = Array.isArray(item.interactionStatistic)
              ? item.interactionStatistic
              : [item.interactionStatistic];
            for (const stat of stats) {
              if (stat.interactionType?.includes("WatchAction")) {
                meta.viewCount = String(stat.userInteractionCount);
              }
            }
          }
          return meta;
        }
      }
    } catch {}
  }

  const extractMeta = (
    attr: string,
    value: string
  ): string | null => {
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

  return {
    title:
      extractMeta("property", "og:title") ||
      extractMeta("name", "twitter:title") ||
      "",
    description:
      extractMeta("property", "og:description") ||
      extractMeta("name", "twitter:description") ||
      "",
    channel:
      extractMeta("itemprop", "author") ||
      extractMeta("name", "author") ||
      "",
    publishDate: extractMeta("itemprop", "datePublished") || "",
    viewCount: extractMeta("itemprop", "interactionCount") || "",
  };
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
          (s: any) => `[${formatTimestamp(s.offset)}] ${s.text}`
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: transcriptErrorText(videoId, err) }],
          isError: true,
        };
      }
    }

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
          (s: any) => `[${formatTimestamp(s.offset)}] ${s.text}`
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

    default:
      return {
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
        isError: true,
      };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
