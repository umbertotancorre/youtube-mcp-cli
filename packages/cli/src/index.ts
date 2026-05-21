import { Command } from "commander";
import fs from "fs";
import pkg from "../package.json";
import {
  extractVideoId,
  fetchVideoMetadata,
  getDownloadsDir,
  transcriptErrorText,
  getTranscriptText,
  getTranscriptTimed,
  searchInTranscript,
  saveTranscriptFile,
  downloadVideoBlocking,
  downloadAudioBlocking,
} from "@umbertotancorre/youtube-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function spinner(msg: string, quiet: boolean): () => void {
  if (quiet || !process.stderr.isTTY) return () => {};
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stderr.write(`${frames[0]} ${msg}`);
  const id = setInterval(() => {
    process.stderr.write(`\r${frames[++i % frames.length]} ${msg}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stderr.write("\r\x1b[K");
  };
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("youtube-cli")
  .description("YouTube transcripts, metadata, search, and downloads from the command line")
  .version(pkg.version)
  .option("--quiet", "suppress progress output")
  .addHelpText("after", `
Examples:
  $ youtube-cli transcript https://youtu.be/dQw4w9WgXcQ
  $ youtube-cli transcript dQw4w9WgXcQ --timestamps
  $ youtube-cli search dQw4w9WgXcQ "never gonna"
  $ youtube-cli metadata https://youtube.com/watch?v=dQw4w9WgXcQ --json
  $ youtube-cli download dQw4w9WgXcQ --audio --format mp3`)
  ;

// unknown command
program.on("command:*", (operands) => {
  process.stderr.write(`error: unknown command '${operands[0]}'\n\nRun 'youtube-cli --help' for a list of commands.\n`);
  process.exit(1);
});

// ── transcript ────────────────────────────────────────────────────────────────

program
  .command("transcript <url>")
  .description("Print transcript of a YouTube video")
  .addHelpText("after", `
Examples:
  $ youtube-cli transcript dQw4w9WgXcQ
  $ youtube-cli transcript dQw4w9WgXcQ --timestamps
  $ youtube-cli transcript dQw4w9WgXcQ --save
  $ youtube-cli transcript dQw4w9WgXcQ --language it`)
  .option("-l, --language <code>", "language code", "en")
  .option("-t, --timestamps", "include [MM:SS] timestamps")
  .option("-s, --save", "save as .md file to Downloads instead of printing")
  .action(async (url: string, opts: { language: string; timestamps?: boolean; save?: boolean }) => {
    const { quiet } = program.opts();
    const videoId = extractVideoId(url);
    if (!videoId) fatal(`invalid YouTube URL or video ID: "${url}"`);

    if (opts.save) {
      const dir = getDownloadsDir();
      fs.mkdirSync(dir, { recursive: true });
      const stop = spinner("Saving transcript", quiet);
      try {
        const filepath = await saveTranscriptFile(videoId, opts.language, dir, !!opts.timestamps);
        stop();
        console.log(`Saved to: ${filepath}`);
      } catch (err) {
        stop();
        fatal(transcriptErrorText(videoId, err));
      }
      return;
    }

    const stop = spinner("Fetching transcript", quiet);
    try {
      const text = opts.timestamps
        ? await getTranscriptTimed(videoId, opts.language)
        : await getTranscriptText(videoId, opts.language);
      stop();
      console.log(text);
    } catch (err) {
      stop();
      fatal(transcriptErrorText(videoId, err));
    }
  });

// ── search ────────────────────────────────────────────────────────────────────

program
  .command("search <url> <query>")
  .description("Search for a keyword in the transcript with timestamps")
  .addHelpText("after", `
Examples:
  $ youtube-cli search dQw4w9WgXcQ "never gonna"
  $ youtube-cli search dQw4w9WgXcQ "chorus" --language en`)
  .option("-l, --language <code>", "language code", "en")
  .action(async (url: string, query: string, opts: { language: string }) => {
    const { quiet } = program.opts();
    const videoId = extractVideoId(url);
    if (!videoId) fatal(`invalid YouTube URL or video ID: "${url}"`);

    const stop = spinner(`Searching for "${query}"`, quiet);
    try {
      const result = await searchInTranscript(videoId, query, opts.language);
      stop();
      if (result.startsWith("No matches found")) {
        process.stderr.write(`${result}\n`);
        process.exit(1);
      }
      console.log(result);
    } catch (err) {
      stop();
      fatal(transcriptErrorText(videoId, err));
    }
  });

// ── metadata ──────────────────────────────────────────────────────────────────

program
  .command("metadata <url>")
  .description("Print title, channel, views, duration, and description")
  .addHelpText("after", `
Examples:
  $ youtube-cli metadata dQw4w9WgXcQ
  $ youtube-cli metadata dQw4w9WgXcQ --json
  $ youtube-cli metadata dQw4w9WgXcQ --json | jq '.title'`)
  .option("-j, --json", "output as JSON")
  .action(async (url: string, opts: { json?: boolean }) => {
    const { quiet } = program.opts();
    const videoId = extractVideoId(url);
    if (!videoId) fatal(`invalid YouTube URL or video ID: "${url}"`);

    const stop = spinner("Fetching metadata", quiet);
    try {
      const meta = await fetchVideoMetadata(videoId);
      stop();
      if (opts.json) {
        console.log(JSON.stringify(meta, null, 2));
        return;
      }
      if (meta.title) console.log(`Title:       ${meta.title}`);
      if (meta.channel) console.log(`Channel:     ${meta.channel}`);
      if (meta.publishDate) console.log(`Published:   ${meta.publishDate}`);
      if (meta.viewCount) console.log(`Views:       ${meta.viewCount}`);
      if (meta.duration) console.log(`Duration:    ${meta.duration}`);
      if (meta.channelUrl) console.log(`Channel URL: ${meta.channelUrl}`);
      if (meta.channelId) console.log(`Channel ID:  ${meta.channelId}`);
      if (meta.description) console.log(`\nDescription:\n${meta.description}`);
    } catch (err) {
      stop();
      const msg = err instanceof Error ? err.message : String(err);
      fatal(`failed to fetch metadata: ${msg}`);
    }
  });

// ── download ──────────────────────────────────────────────────────────────────

program
  .command("download <url>")
  .description("Download video or audio to Downloads folder")
  .addHelpText("after", `
Examples:
  $ youtube-cli download dQw4w9WgXcQ
  $ youtube-cli download dQw4w9WgXcQ --quality hd1080
  $ youtube-cli download dQw4w9WgXcQ --audio
  $ youtube-cli download dQw4w9WgXcQ --audio --format flac`)
  .option("-a, --audio", "download audio only")
  .option("-q, --quality <q>", "video quality: best, hd1080, hd720, sd480, sd360", "hd720")
  .option("-f, --format <fmt>", "audio format: mp3, m4a, aac, flac, opus, wav, vorbis", "mp3")
  .action(async (url: string, opts: { audio?: boolean; quality: string; format: string }) => {
    const videoId = extractVideoId(url);
    if (!videoId) fatal(`invalid YouTube URL or video ID: "${url}"`);

    const dir = getDownloadsDir();
    fs.mkdirSync(dir, { recursive: true });
    if (!program.opts().quiet) process.stderr.write(`Saving to ${dir}\n`);

    try {
      if (opts.audio) {
        await downloadAudioBlocking(videoId, opts.format, dir);
      } else {
        await downloadVideoBlocking(videoId, opts.quality, dir);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fatal(msg);
    }
  });

// ── completions ───────────────────────────────────────────────────────────────

const BASH_COMPLETION = `
_youtube_cli_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="transcript search metadata download completions"
  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=(\$(compgen -W "$commands" -- "$cur"))
    return 0
  fi
  case "$prev" in
    transcript) COMPREPLY=(\$(compgen -W "--timestamps --save --language --help" -- "$cur")) ;;
    search)     COMPREPLY=(\$(compgen -W "--language --quiet --help" -- "$cur")) ;;
    metadata)   COMPREPLY=(\$(compgen -W "--json --quiet --help" -- "$cur")) ;;
    download)   COMPREPLY=(\$(compgen -W "--audio --quality --format --help" -- "$cur")) ;;
  esac
}
complete -F _youtube_cli_complete youtube-cli
`.trim();

const ZSH_COMPLETION = `
#compdef youtube-cli
_youtube_cli() {
  local -a commands
  commands=(
    'transcript:Print transcript of a YouTube video'
    'search:Search transcript with timestamps'
    'metadata:Print video metadata'
    'download:Download video or audio'
    'completions:Print shell completion script'
  )
  case $CURRENT in
    2) _describe 'command' commands ;;
    *)
      case $words[2] in
        transcript) _arguments '-l[language code]:code' '-t[include timestamps]' '-s[save to Downloads]' ;;
        search)     _arguments '-l[language code]:code' ;;
        metadata)   _arguments '-j[output as JSON]' ;;
        download)   _arguments '-a[audio only]' '-q[quality]:quality:(best hd1080 hd720 sd480 sd360)' '-f[format]:format:(mp3 m4a aac flac opus wav vorbis)' ;;
      esac
  esac
}
_youtube_cli
`.trim();

program
  .command("completions [shell]")
  .description("Print shell completion script — source with: source <(youtube-cli completions)")
  .addHelpText("after", `
Examples:
  $ source <(youtube-cli completions)
  $ youtube-cli completions zsh > ~/.zsh/completions/_youtube-cli`)
  .action((shell = "bash") => {
    if (shell === "zsh") {
      console.log(ZSH_COMPLETION);
    } else {
      console.log(BASH_COMPLETION);
    }
  });

if (process.argv.length === 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
