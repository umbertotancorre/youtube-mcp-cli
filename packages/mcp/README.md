# @umbertotancorre/youtube-mcp

[![npm](https://img.shields.io/npm/v/@umbertotancorre/youtube-mcp)](https://www.npmjs.com/package/@umbertotancorre/youtube-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Zero Setup · No API Key · No Account · Open Source**

An [MCP](https://modelcontextprotocol.io) server that gives any MCP-compatible AI agent the ability to access YouTube:

- Fetch transcript (plain text or with timestamps)
- Download transcript as `.md`
- Get video metadata
- Search within captions
- Download video or audio

All locally, no third-party API keys.

## Installation

**Method A: let your AI do it**

Tell your AI agent:

```
Add youtube-mcp as an MCP server. Run it with: npx @umbertotancorre/youtube-mcp
```

**Method B: manual config**

Add this to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "@umbertotancorre/youtube-mcp"]
    }
  }
}
```

All tools appear automatically. No install needed, `npx` handles it on first run.

## Tools

| Tool | Description |
|---|---|
| `get_transcript` | Fetches the full transcript as plain text |
| `get_transcript_timed` | Transcript with `[MM:SS]` timestamps per segment |
| `download_transcript` | Saves transcript as a `.md` file |
| `download_transcript_timed` | Saves transcript as a `.md` file with timestamps |
| `get_metadata` | Returns title, channel, publish date, view count, duration, likes, and description |
| `search_transcript` | Searches for a keyword or phrase and returns matching segments with timestamps |
| `download_video` | Downloads video+audio as `.mp4` |
| `download_audio` | Downloads audio as `.mp3` (or `m4a`, `flac`, `opus`, etc.) |

`download_video` and `download_audio` are fully self-contained. [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://github.com/FFmpeg/FFmpeg) are downloaded automatically on install.

## Also available

Looking for a terminal tool instead? See [`@umbertotancorre/youtube-cli`](https://www.npmjs.com/package/@umbertotancorre/youtube-cli).

## Disclaimer

This project only accesses **publicly available** YouTube data: the same captions, metadata, and streams visible in any browser. It does not bypass authentication, paywalls, or age gates.

End users are responsible for complying with YouTube's Terms of Service. This is a local tool you run on your own machine.

## License

`@umbertotancorre/youtube-mcp` is fully open source, licensed under the [MIT License](LICENSE).
