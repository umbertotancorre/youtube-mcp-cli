# YouTube CLI

[![npm](https://img.shields.io/npm/v/@umbertotancorre/youtube-cli)](https://www.npmjs.com/package/@umbertotancorre/youtube-cli)
[![npm downloads](https://img.shields.io/npm/dt/@umbertotancorre/youtube-cli?color=blue)](https://www.npmjs.com/package/@umbertotancorre/youtube-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

A command-line tool to access YouTube from your terminal:

- Fetch transcript (plain text or with timestamps)
- Download transcript as `.md`
- Get video metadata
- Search within captions
- Download video or audio

All locally. No API keys required.

## Installation

**Global install (recommended):**

```bash
npm install -g @umbertotancorre/youtube-cli
```

**One-off use without installing:**

```bash
npx @umbertotancorre/youtube-cli transcript dQw4w9WgXcQ
```

## Commands

```
youtube-cli --help                            Show all commands and options
youtube-cli --version                         Print the installed version

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

## Shell completions (optional)

```bash
# bash
source <(youtube-cli completions)

# zsh
youtube-cli completions zsh > ~/.zsh/completions/_youtube-cli
```

## Also available

Looking for an AI agent integration instead? See [`@umbertotancorre/youtube-mcp`](https://www.npmjs.com/package/@umbertotancorre/youtube-mcp).

## Disclaimer

This project only accesses **publicly available** YouTube data: the same captions, metadata, and streams visible in any browser. It does not bypass authentication, paywalls, or age gates.

End users are responsible for complying with YouTube's Terms of Service. This is a local tool you run on your own machine.

## License

`@umbertotancorre/youtube-cli` is fully open source, licensed under the [MIT License](LICENSE).
