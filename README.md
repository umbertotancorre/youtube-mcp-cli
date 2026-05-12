# YouTube MCP Server

**Free · Open Source · No API key required · No registration**

Most LLMs cannot access YouTube video content. They don't know what's in a video - no transcript, no metadata, nothing. This server solves that.

An [MCP](https://modelcontextprotocol.io) server that gives any MCP-compatible AI assistant (Claude Desktop, Cursor, VS Code, Zed, and others) the ability to fetch YouTube video transcripts, metadata, and search within captions - all locally, no third-party services.

## How It Works

The Model Context Protocol (MCP) lets you expose local tools to an AI assistant. This project implements an MCP server with 4 tools that communicate over stdio. When you ask your AI a question about a YouTube video, it calls these tools automatically.

```
You ask AI --> AI decides which tool to call --> Server fetches YouTube data --> AI reads the result and answers
```

## Tools

| Tool | Description |
|---|---|
| `get_transcript` | Fetches the full transcript of a video as plain text |
| `get_transcript_timestamps` | Same as above, but each segment is prefixed with a `[MM:SS]` timestamp |
| `get_video_metadata` | Returns title, channel, description, publish date, view count, and duration |
| `search_in_transcript` | Searches for a keyword or phrase in the transcript and returns matching segments with timestamps |

All tools accept a YouTube URL, mobile link, short link, or bare video ID, plus an optional language code (`language: "en"`, `"it"`, etc.).

## Quick Start

### Easiest: just tell your AI

If your AI supports installing MCP servers directly, simply tell it:

> "Install the YouTube MCP server from this repo: https://github.com/umbertotancorre/youtube-mcp"

It will clone, build, and configure itself.

### Manual setup

```bash
git clone https://github.com/umbertotancorre/youtube-mcp
cd youtube-mcp
npm install
npm run build
```

Then point your MCP client (Claude, Cursor, VS Code, Zed, etc.) to:

```
node /path/to/youtube-mcp/dist/index.js
```

That is the only line you need in any MCP config. The 4 tools will appear automatically.

## Example Queries

Just type naturally and your AI will use the right tools:

- "Summarize this video: https://youtube.com/watch?v=dQw4w9WgXcQ"
- "What are the main topics in this video? https://youtu.be/abc123"
- "Search for 'AI' in this video and give me timestamps: https://youtube.com/watch?v=xyz789"
- "Give me the metadata for this video: https://youtube.com/watch?v=..."
- "Get the transcript with timestamps for video ID dQw4w9WgXcQ"

## Development

```bash
npm run dev    # run directly with ts-node (no build step)
npm run build  # compile TypeScript to dist/
npm start      # run the compiled output
```

## How Transcripts Are Fetched

The server uses the [`youtube-transcript`](https://www.npmjs.com/package/youtube-transcript) package, which scrapes YouTube's publicly available captions (auto-generated or uploader-provided). No API key is required. Metadata is extracted by scraping YouTube's page HTML for Open Graph tags and JSON-LD structured data.

## Limitations

- Some videos have captions disabled, are age-restricted, or are private - transcripts won't be available
- Auto-generated captions may contain errors
- Metadata scraping depends on YouTube's page structure and may break if they change it
- This server only operates on **existing video URLs** - it cannot search YouTube's catalog (you would need the YouTube Data API for that, which requires a free API key from Google Cloud Console)

## Disclaimer

This server only accesses **publicly available** YouTube data, the same captions and metadata you see when visiting youtube.com in a browser. It does not bypass any authentication, paywalls, or age gates. No API key, account, or login is required.

End users are responsible for complying with YouTube's Terms of Service. The maintainer of this project does not host, operate, or provide any service, this is a local tool you run on your own machine.