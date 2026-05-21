# youtube-mcp-cli

[![npm mcp](https://img.shields.io/npm/v/@umbertotancorre/youtube-mcp?label=%40umbertotancorre%2Fyoutube-mcp)](https://www.npmjs.com/package/@umbertotancorre/youtube-mcp)
[![npm cli](https://img.shields.io/npm/v/@umbertotancorre/youtube-cli?label=%40umbertotancorre%2Fyoutube-cli)](https://www.npmjs.com/package/@umbertotancorre/youtube-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Zero Setup · No API Key · No Account · Open Source**

One repo, two packages. Access YouTube from your AI agent or your terminal:

| Want to… | Use |
|---|---|
| Give YouTube tools to an AI (Claude, Cursor, etc.) | [`@umbertotancorre/youtube-mcp`](#mcp-server) |
| Use YouTube tools from the terminal | [`@umbertotancorre/youtube-cli`](#cli) |

Capabilities shared by both:

- Fetch transcript (plain text or with timestamps)
- Download transcript as `.md`
- Get video metadata
- Search within captions
- Download video or audio

All locally, no third-party API keys.

---

## Table of Contents

- [MCP Server](#mcp-server)
  - [Tools](#tools)
  - [Installation](#installation)
- [CLI](#cli)
  - [Commands](#commands)
  - [Installation](#installation-1)
- [Development](#development)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## MCP Server

### Tools

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

`download_video` and `download_audio` are fully self-contained. [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://github.com/FFmpeg/FFmpeg) are downloaded automatically on `npm install`.

### Installation

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

---

## CLI

### Commands

```
youtube-cli transcript <url>                  Print transcript as plain text
youtube-cli transcript <url> --timestamps     Include [MM:SS] timestamps
youtube-cli transcript <url> --save           Save as .md to Downloads
youtube-cli transcript <url> --language it    Fetch in a specific language

youtube-cli search <url> <query>              Search transcript with timestamps
youtube-cli metadata <url>                    Print title, channel, views, duration
youtube-cli metadata <url> --json             Output as JSON

youtube-cli download <url>                    Download video to Downloads
youtube-cli download <url> --quality hd1080   Choose quality
youtube-cli download <url> --audio            Download audio only (mp3)
youtube-cli download <url> --audio --format flac

youtube-cli completions                       Print bash completion script
youtube-cli completions zsh                   Print zsh completion script
```

Downloads always go to the platform-native Downloads folder:

| OS | Path |
|---|---|
| macOS | `~/Downloads` |
| Linux | `$XDG_DOWNLOAD_DIR` or `~/Downloads` |
| Windows | `%USERPROFILE%\Downloads` |

### Installation

**Global install (recommended):**

```bash
npm install -g @umbertotancorre/youtube-cli
youtube-cli --help
```

**One-off use without installing:**

```bash
npx @umbertotancorre/youtube-cli transcript dQw4w9WgXcQ
```

**Shell completions (optional):**

```bash
# bash
source <(youtube-cli completions)

# zsh
youtube-cli completions zsh > ~/.zsh/completions/_youtube-cli
```

---

## Development

This is an npm workspaces monorepo with three packages:

```
youtube-mcp-cli/
  packages/
    core/     # shared logic (transcripts, metadata, downloads)
    mcp/      # MCP server (@umbertotancorre/youtube-mcp)
    cli/      # CLI tool     (@umbertotancorre/youtube-cli)
```

```bash
npm run build        # build all packages (core, mcp, cli in order)
npm run dev:mcp      # build core, then run MCP server via ts-node
npm run dev:cli      # build core, then run CLI via ts-node
```

---

## Disclaimer

This project only accesses **publicly available** YouTube data: the same captions, metadata, and streams visible in any browser. It does not bypass authentication, paywalls, or age gates. No API key, account, or login is required.

End users are responsible for complying with YouTube's Terms of Service. The maintainer does not host or operate any service. This is a local tool you run on your own machine.

## License

`youtube-mcp-cli` is fully open source, licensed under the [MIT License](LICENSE).
