#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import pkg from "../package.json";
import {
  extractVideoId,
  fetchVideoMetadata,
  resolveOutputDir,
  transcriptErrorText,
  getTranscriptText,
  getTranscriptTimed,
  searchInTranscript,
  saveTranscriptFile,
  startVideoDownload,
  startAudioDownload,
} from "@umbertotancorre/youtube-core";

const server = new Server(
  { name: "youtube-mcp-cli", version: pkg.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_transcript",
      description: "Fetches the transcript of a YouTube video given its URL or video ID.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full YouTube URL or video ID (e.g. https://youtube.com/watch?v=abc123 or just abc123)",
          },
          language: {
            type: "string",
            description: "Optional. Language code for the transcript (e.g. 'en', 'it'). Defaults to 'en'.",
            default: "en",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_transcript_timed",
      description: "Fetches the transcript with timestamps for each segment.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
        },
        required: ["url"],
      },
    },
    {
      name: "get_transcript_timestamps",
      description: "Fetches the transcript with timestamps for each segment. (Alias for get_transcript_timed)",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
        },
        required: ["url"],
      },
    },
    {
      name: "get_metadata",
      description: "Fetches video metadata: title, channel, description, publish date, views, duration.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
        },
        required: ["url"],
      },
    },
    {
      name: "get_video_metadata",
      description: "Fetches video metadata: title, channel, description, publish date, views, duration. (Alias for get_metadata)",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
        },
        required: ["url"],
      },
    },
    {
      name: "search_transcript",
      description: "Searches for a keyword or phrase in the transcript and returns matching segments with timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          query: { type: "string", description: "The keyword or phrase to search for" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
        },
        required: ["url", "query"],
      },
    },
    {
      name: "search_in_transcript",
      description: "Searches for a keyword or phrase in the transcript and returns matching segments with timestamps. (Alias for search_transcript)",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          query: { type: "string", description: "The keyword or phrase to search for" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
        },
        required: ["url", "query"],
      },
    },
    {
      name: "download_video",
      description: "Downloads a YouTube video (video+audio) to the local filesystem. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          quality: {
            type: "string",
            description: "Optional. 'hd720' (default), 'best', 'hd1080', 'sd480', 'sd360'.",
            enum: ["best", "hd1080", "hd720", "sd480", "sd360"],
            default: "hd720",
          },
          outputDir: { type: "string", description: "Optional. Directory to save. Defaults to ~/Downloads." },
        },
        required: ["url"],
      },
    },
    {
      name: "download_audio",
      description: "Downloads audio from a YouTube video. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          format: {
            type: "string",
            description: "Optional. Audio format: 'mp3' (default), 'm4a', 'aac', 'flac', 'opus', 'wav', 'vorbis'.",
            enum: ["mp3", "m4a", "aac", "flac", "opus", "wav", "vorbis"],
            default: "mp3",
          },
          outputDir: { type: "string", description: "Optional. Directory to save. Defaults to ~/Downloads." },
        },
        required: ["url"],
      },
    },
    {
      name: "download_transcript",
      description: "Downloads the transcript of a YouTube video as a markdown file (.md). Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
          outputDir: { type: "string", description: "Optional. Directory to save. Defaults to ~/Downloads." },
        },
        required: ["url"],
      },
    },
    {
      name: "download_transcript_timed",
      description: "Downloads the transcript of a YouTube video as a markdown file (.md) with timestamps. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full YouTube URL or video ID" },
          language: { type: "string", description: "Optional. Language code. Defaults to 'en'.", default: "en" },
          outputDir: { type: "string", description: "Optional. Directory to save. Defaults to ~/Downloads." },
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments || {}) as Record<string, any>;
  const url = (args.url as string) || "";
  const videoId = extractVideoId(url);

  switch (request.params.name) {
    case "get_transcript": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      try {
        const text = await getTranscriptText(videoId, language);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: transcriptErrorText(videoId, err) }], isError: true };
      }
    }

    case "get_transcript_timed":
    case "get_transcript_timestamps": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      try {
        const text = await getTranscriptTimed(videoId, language);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: transcriptErrorText(videoId, err) }], isError: true };
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
        if (meta.description) lines.push(`Description: ${meta.description}`);
        return {
          content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No metadata found." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Failed to fetch metadata: ${msg}` }], isError: true };
      }
    }

    case "search_transcript":
    case "search_in_transcript": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      const query = (args.query as string) || "";
      if (!query.trim()) {
        return { content: [{ type: "text", text: "Please provide a non-empty search query." }], isError: true };
      }
      try {
        const text = await searchInTranscript(videoId, query, language);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: transcriptErrorText(videoId, err) }], isError: true };
      }
    }

    case "download_video": {
      if (!videoId) return invalidUrlResponse(url);
      const quality = (args.quality as string) || "hd720";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return { content: [{ type: "text", text: "Invalid outputDir: must be within the home or temp directory." }], isError: true };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      try {
        const text = await startVideoDownload(videoId, quality, outputDir);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }

    case "download_audio": {
      if (!videoId) return invalidUrlResponse(url);
      const audioFormat = (args.format as string) || "mp3";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return { content: [{ type: "text", text: "Invalid outputDir: must be within the home or temp directory." }], isError: true };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      try {
        const text = await startAudioDownload(videoId, audioFormat, outputDir);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }

    case "download_transcript":
    case "download_transcript_timed": {
      if (!videoId) return invalidUrlResponse(url);
      const language = (args.language as string) || "en";
      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      if (!outputDir) {
        return { content: [{ type: "text", text: "Invalid outputDir: must be within the home or temp directory." }], isError: true };
      }
      fs.mkdirSync(outputDir, { recursive: true });
      const withTimestamps = request.params.name === "download_transcript_timed";
      try {
        const filepath = await saveTranscriptFile(videoId, language, outputDir, withTimestamps);
        return { content: [{ type: "text", text: `Transcript saved to: ${filepath}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: transcriptErrorText(videoId, err) }], isError: true };
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
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
