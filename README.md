# YouTube MCP Server

[![npm](https://img.shields.io/npm/v/@umbertotancorre/youtube-mcp)](https://www.npmjs.com/package/@umbertotancorre/youtube-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![GitHub stars](https://img.shields.io/github/stars/umbertotancorre/youtube-mcp)](https://github.com/umbertotancorre/youtube-mcp)

**Zero Setup · No API Key · No Account · Open Source**

An [MCP](https://modelcontextprotocol.io) server that gives any MCP-compatible AI agents the ability to access YouTube knowledge:

- Fetch transcript (with or without timestamps)
- Download transcript as `.md` (with or without timestamps)
- Get video metadata
- Search within captions
- Download videos
- Download audio

All locally, no third-party API keys.

## Table of Contents

- [How It Works](#how-it-works)
- [Tools](#tools)
- [Installation](#installation)
  - [Method A: AI Setup](#method-a-ai-setup)
  - [Method B: Manual Setup](#method-b-manual-setup)
- [Development](#development)
  - [Commands](#commands)
  - [Layout](#layout)
- [Disclaimer](#disclaimer)
- [License](#license)

## How It Works

The Model Context Protocol (MCP) lets you expose local tools to an AI agent. This project implements an MCP server with **8 tools**.

## Tools

| Tool | Description |
|------|-------------|
| `get_transcript` | Fetches the full transcript of a video as plain text |
| `get_transcript_timed` | Same as above, but each segment is prefixed with a `[MM:SS]` timestamp |
| `download_transcript` | Downloads the transcript as a `.md` file |
| `download_transcript_timed` | Downloads the transcript as a `.md` file with timestamps |
| `get_metadata` | Returns title, channel, publish date, view count, duration, category, likes, channel URL, channel ID, and description |
| `search_transcript` | Searches for a keyword or phrase in the transcript and returns matching segments with timestamps |
| `download_video` | Downloads a video (video+audio) as `.mp4` to your machine |
| `download_audio` | Downloads audio as `.mp3` (or `m4a`, `flac`, `opus`, etc.) to your machine |

`download_video` and `download_audio` are fully self-contained. Both [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://github.com/FFmpeg/FFmpeg) are downloaded automatically during `npm install` - no manual setup needed.

## Installation

Two ways to get started:

### Method A: AI setup

If your AI supports installing MCP servers directly, simply tell it:

```
Add youtube-mcp as an MCP server. Run it with: npx @umbertotancorre/youtube-mcp
```

### Method B: Manual setup

```bash
npx @umbertotancorre/youtube-mcp
```

Then point your MCP client to:

```
npx @umbertotancorre/youtube-mcp
```

That is the only line you need in any MCP config. All tools will appear automatically.

## Development

### Commands

```bash
npm run dev    # run directly with ts-node (no build step)
npm run build  # compile TypeScript to dist/
npm start      # run the compiled output
```

### Layout

```
youtube-mcp/
  src/
    index.ts          # MCP server with all 8 tools
  dist/               # Compiled JavaScript output
  node_modules/       # Dependencies (ignored by git)
  package.json
  tsconfig.json
  README.md
  LICENSE
  .npmignore
```

## Disclaimer

This server only accesses **publicly available** YouTube data, the same captions, metadata, and streams you see when visiting youtube.com in a browser. It does not bypass any authentication, paywalls, or age gates. No API key, account, or login is required.

End users are responsible for complying with YouTube's Terms of Service. The maintainer of this project does not host, operate, or provide any service, this is a local tool you run on your own machine.

## License

`@umbertotancorre/youtube-mcp` is fully open source, licensed under the [MIT License](LICENSE).