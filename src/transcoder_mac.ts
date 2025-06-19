import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";
import { logWithTimestamp } from "./lib/utils";
import { showStep } from "./lib/utils";
import { createProgressBar } from "./lib/utils";

const input = "dragon.mkv";
const outputDir = "output";

async function transcodeResolutions() {
  showStep(1, "Video Transcoding", "Converting video to multiple resolutions");

  const resolutions = [
    {
      name: "1080p",
      width: 1920,
      height: 1080,
      crf: 26,
      maxrate: "4000k",
      bufsize: "6000k",
    },
    {
      name: "720p",
      width: 1280,
      height: 720,
      crf: 28,
      maxrate: "2500k",
      bufsize: "4000k",
    },
    {
      name: "480p",
      width: 854,
      height: 480,
      crf: 30,
      maxrate: "1500k",
      bufsize: "2500k",
    },
  ];

  for (const resolution of resolutions) {
    const progress = createProgressBar(`Transcoding ${resolution.name}`, 100);

    try {
      progress.update(10, "Initializing...");
      const outputPath = path.join(outputDir, resolution.name);
      await fs.ensureDir(outputPath);

      progress.update(20, "Starting Apple Silicon transcoding...");

      // Use VideoToolbox hardware encoder for Apple Silicon
      try {
        const macArgs = [
          "-y",
          "-i",
          input,
          "-c:v",
          "hevc_videotoolbox", // Use Apple's VideoToolbox H.265/HEVC encoder
          "-allow_sw",
          "1", // Allow software fallback if hardware encoding fails
          "-b:v",
          resolution.maxrate,
          "-maxrate",
          resolution.maxrate,
          "-bufsize",
          resolution.bufsize,
          "-vf",
          `scale=${resolution.width}:${resolution.height}`,
          "-profile:v",
          "main",
          "-tag:v",
          "hvc1", // Use hvc1 tag for better compatibility
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          path.join(outputPath, "segment%03d.ts"),
          path.join(outputPath, "playlist.m3u8"),
        ];

        progress.update(30, "Processing with VideoToolbox...");

        const { stderr } = await execa("ffmpeg", macArgs, {
          reject: false,
        });

        // Check if there was an error with VideoToolbox
        if (stderr && stderr.includes("Error using VideoToolbox")) {
          throw new Error("VideoToolbox encoding failed");
        }

        progress.update(90, "Finalizing transcoding...");
        progress.complete();
      } catch (gpuError) {
        // If VideoToolbox fails, fall back to software encoding
        progress.update(30, "Hardware encoding failed, using software...");
        logWithTimestamp(
          `Hardware encoding failed: ${gpuError}. Falling back to software encoding.`,
          chalk.yellow
        );

        const softwareArgs = [
          "-y",
          "-i",
          input,
          "-c:v",
          "libx265", // Software H.265 encoder
          "-crf",
          resolution.crf.toString(),
          "-preset",
          "medium",
          "-maxrate",
          resolution.maxrate,
          "-bufsize",
          resolution.bufsize,
          "-vf",
          `scale=${resolution.width}:${resolution.height}`,
          "-profile:v",
          "main",
          "-tag:v",
          "hvc1",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          path.join(outputPath, "segment%03d.ts"),
          path.join(outputPath, "playlist.m3u8"),
        ];

        await execa("ffmpeg", softwareArgs, {
          reject: false,
        });

        progress.update(90, "Finalizing software transcoding...");
        progress.complete("Completed with software encoding");
      }
    } catch (error) {
      progress.fail(`Error: ${error}`);
      logWithTimestamp(
        `Failed to transcode ${resolution.name}: ${error}`,
        chalk.red
      );
    }
  }
}

async function extractAudioTracks() {
  showStep(2, "Audio Extraction", "Analyzing and extracting audio streams");

  const analysisProgress = createProgressBar("Analyzing audio streams", 100);

  try {
    analysisProgress.update(20, "Running ffprobe...");

    // Use ffprobe to get information about all audio streams
    const { stdout: audioStreams } = await execa(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index:stream_tags=language",
        "-of",
        "json",
        input,
      ],
      { reject: false }
    );

    analysisProgress.update(60, "Parsing stream data...");

    // Parse the JSON output
    const audioInfo = JSON.parse(audioStreams);
    const availableAudioStreams = audioInfo.streams || [];

    analysisProgress.update(80, "Stream analysis complete");
    analysisProgress.complete(
      `Found ${availableAudioStreams.length} audio stream(s)`
    );

    logWithTimestamp(
      `📊 Detected ${availableAudioStreams.length} audio stream(s)`,
      chalk.blue
    );

    if (availableAudioStreams.length === 0) {
      logWithTimestamp(
        "⚠ No audio streams found in the input file.",
        chalk.yellow
      );
      return;
    }

    // Create audio directory if it doesn't exist
    const audioBaseDir = path.join(outputDir, "audio");
    await fs.ensureDir(audioBaseDir);

    // Process each audio stream
    for (let i = 0; i < availableAudioStreams.length; i++) {
      const stream = availableAudioStreams[i];
      const streamIndex = stream.index;

      // Get language from metadata
      const language = stream.tags?.language || "und"; // Use 'und' (undefined) if language is not specified

      const audioProgress = createProgressBar(
        `Extracting audio [${language}]`,
        100
      );

      try {
        audioProgress.update(10, "Creating output directory...");
        const audioLangDir = path.join(audioBaseDir, language);
        await fs.ensureDir(audioLangDir);

        audioProgress.update(30, "Starting audio extraction...");

        // Extract audio in AAC format for better compatibility
        const audioArgs = [
          "-y",
          "-i",
          input,
          "-map",
          `0:${streamIndex}`,
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ac",
          "2",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          path.join(audioLangDir, "segment%03d.aac"),
          path.join(audioLangDir, "playlist.m3u8"),
        ];

        audioProgress.update(40, "Extracting audio stream...");

        await execa("ffmpeg", audioArgs, {
          reject: false,
        });

        audioProgress.complete(`Audio track [${language}] extracted`);
      } catch (error) {
        audioProgress.fail(`Error: ${error}`);
        logWithTimestamp(
          `Failed to extract audio track ${i} (${language}): ${error}`,
          chalk.red
        );
      }
    }
  } catch (error) {
    analysisProgress.fail(`Error: ${error}`);
    logWithTimestamp(`Failed to analyze audio streams: ${error}`, chalk.red);
  }
}

async function copySubtitles() {
  showStep(
    3,
    "Subtitle Processing",
    "Checking embedded and external subtitles"
  );

  const subtitleProgress = createProgressBar("Processing subtitles", 100);

  subtitleProgress.update(10, "Analyzing embedded subtitles...");

  // First, check for embedded subtitles in the input file
  let embeddedSubtitles = [];
  try {
    // Use ffprobe to get information about subtitle streams
    const { stdout: subtitleStreams } = await execa(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "s", // Select subtitle streams only
        input,
      ],
      { reject: false }
    );

    subtitleProgress.update(30, "Parsing embedded subtitle data...");

    if (subtitleStreams) {
      const subtitleInfo = JSON.parse(subtitleStreams);
      const availableSubtitleStreams = subtitleInfo.streams || [];

      logWithTimestamp(
        `📊 Detected ${availableSubtitleStreams.length} embedded subtitle stream(s)`,
        chalk.blue
      );

      if (availableSubtitleStreams.length > 0) {
        subtitleProgress.update(40, "Extracting embedded subtitles...");

        // Extract each embedded subtitle stream
        for (let i = 0; i < availableSubtitleStreams.length; i++) {
          const stream = availableSubtitleStreams[i];
          const streamIndex = stream.index;

          // Get language from metadata
          const language = stream.tags?.language || "und";

          try {
            // Create subtitles directory
            const subsDir = path.join(outputDir);
            await fs.ensureDir(subsDir);

            // Extract subtitle to WebVTT format for web compatibility
            const subsPath = path.join(subsDir, `subs_${language}.vtt`);

            await execa(
              "ffmpeg",
              [
                "-y",
                "-i",
                input,
                "-map",
                `0:${streamIndex}`,
                "-c:s",
                "webvtt",
                subsPath,
              ],
              { reject: false }
            );

            embeddedSubtitles.push({
              language,
              path: subsPath,
            });

            logWithTimestamp(
              `✅ Extracted subtitle track ${i} (${language})`,
              chalk.green
            );
          } catch (error) {
            logWithTimestamp(
              `⚠ Failed to extract subtitle track ${i} (${language}): ${error}`,
              chalk.yellow
            );
          }
        }
      }
    }

    // Check for external subtitle files
    subtitleProgress.update(70, "Checking for external subtitles...");

    const inputDir = path.dirname(input);
    const inputBaseName = path.basename(input, path.extname(input));

    // Common subtitle extensions
    const subtitleExtensions = [".srt", ".ass", ".ssa", ".vtt"];

    for (const ext of subtitleExtensions) {
      const potentialSubFile = path.join(inputDir, `${inputBaseName}${ext}`);

      if (await fs.pathExists(potentialSubFile)) {
        try {
          const subsDir = path.join(outputDir);
          // Convert to WebVTT if not already
          if (ext !== ".vtt") {
            const outputVtt = path.join(subsDir, `subs_external.vtt`);
            await execa("ffmpeg", ["-y", "-i", potentialSubFile, outputVtt], {
              reject: false,
            });

            logWithTimestamp(
              `✅ Converted external subtitle file ${potentialSubFile} to WebVTT`,
              chalk.green
            );
          } else {
            // Just copy the VTT file
            await fs.copy(
              potentialSubFile,
              path.join(subsDir, `subs_external.vtt`)
            );
            logWithTimestamp(
              `✅ Copied external subtitle file ${potentialSubFile}`,
              chalk.green
            );
          }
        } catch (error) {
          logWithTimestamp(
            `⚠ Failed to process external subtitle ${potentialSubFile}: ${error}`,
            chalk.yellow
          );
        }
      }
    }

    subtitleProgress.complete(
      `Processed ${embeddedSubtitles.length} subtitle tracks`
    );
  } catch (error) {
    subtitleProgress.fail(`Error: ${error}`);
    logWithTimestamp(`Failed to process subtitles: ${error}`, chalk.red);
  }
}

async function writeMasterPlaylist() {
  showStep(4, "Master Playlist Generation", "Creating dynamic master playlist");

  const playlistProgress = createProgressBar("Generating master playlist", 100);

  playlistProgress.update(20, "Scanning audio directory...");

  // Check which audio tracks are available by scanning the audio directory
  const audioBaseDir = path.join(outputDir, "audio");
  let audioTracks: Array<{
    file: string;
    language: string;
    name: string;
    code: string;
    default: boolean;
  }> = [];

  try {
    // Check if audio directory exists
    if (await fs.pathExists(audioBaseDir)) {
      // Get all language subdirectories
      const languageDirs = await fs.readdir(audioBaseDir, {
        withFileTypes: true,
      });

      for (const dirent of languageDirs) {
        if (dirent.isDirectory()) {
          const language = dirent.name;
          const playlistPath = path.join(
            audioBaseDir,
            language,
            "playlist.m3u8"
          );

          // Check if the playlist file exists
          if (await fs.pathExists(playlistPath)) {
            // Map language codes to full names
            const languageMap: Record<
              string,
              { name: string; code: string; default: boolean }
            > = {
              eng: { name: "English", code: "en", default: true },
              hin: { name: "Hindi", code: "hi", default: false },
              fre: { name: "French", code: "fr", default: false },
              spa: { name: "Spanish", code: "es", default: false },
              ger: { name: "German", code: "de", default: false },
              jpn: { name: "Japanese", code: "ja", default: false },
            };

            const langInfo = languageMap[language] || {
              name: language.charAt(0).toUpperCase() + language.slice(1),
              code: language.substring(0, 2),
              default: false,
            };

            // Use relative path for the playlist file in the master playlist
            const relativePath = path
              .join("audio", language, "playlist.m3u8")
              .replace(/\\/g, "/");

            audioTracks.push({
              file: relativePath,
              language,
              name: langInfo.name,
              code: langInfo.code,
              default: langInfo.default,
            });
          }
        }
      }
    }
  } catch (error) {
    logWithTimestamp(`Error scanning audio directories: ${error}`, chalk.red);
  }

  // If we have multiple tracks, make sure only one is default
  if (audioTracks.length > 0) {
    // Find if there's any track marked as default
    const hasDefault = audioTracks.some((track) => track.default);

    // If no default is set, make the first one default
    if (!hasDefault && audioTracks.length > 0) {
      audioTracks[0].default = true;
    }
  }

  // Check which subtitle files are available
  const subtitleFiles = (await fs.readdir(outputDir))
    .filter((file) => file.endsWith(".vtt") && file.startsWith("subs_"))
    .map((file) => {
      const language = file.replace("subs_", "").replace(".vtt", "");

      // Map language codes to full names
      const languageMap: Record<
        string,
        { name: string; code: string; default: boolean }
      > = {
        eng: { name: "English", code: "en", default: true },
        hin: { name: "Hindi", code: "hi", default: false },
        fre: { name: "French", code: "fr", default: false },
        spa: { name: "Spanish", code: "es", default: false },
        ger: { name: "German", code: "de", default: false },
        jpn: { name: "Japanese", code: "ja", default: false },
      };

      const langInfo = languageMap[language] || {
        name: language.charAt(0).toUpperCase() + language.slice(1),
        code: language.substring(0, 2),
        default: false,
      };

      return {
        file,
        language,
        name: langInfo.name,
        code: langInfo.code,
        default: langInfo.default,
      };
    });

  // If we have multiple subtitles, make sure only one is default
  if (subtitleFiles.length > 0) {
    // Find if there's any subtitle marked as default
    const hasDefault = subtitleFiles.some((sub) => sub.default);

    // If no default is set, make the first one default
    if (!hasDefault && subtitleFiles.length > 0) {
      subtitleFiles[0].default = true;
    }
  }

  // Check which video resolutions are available
  const resolutionDirs = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory() && dirent.name.endsWith("p"))
    .map((dirent) => dirent.name);

  // Build the master playlist dynamically based on available tracks
  let content = `#EXTM3U\n\n`;

  // Note: Subtitles are handled directly by the player, not in the master playlist
  // as EXT-X-MEDIA entries. The .vtt files will be loaded separately by the player.

  // Add audio tracks if they exist
  if (audioTracks.length > 0) {
    content += `# Audio tracks\n`;
    for (const track of audioTracks) {
      content += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${
        track.name
      }",LANGUAGE="${track.code}",URI="${track.file}",DEFAULT=${
        track.default ? "YES" : "NO"
      }\n`;
    }
    content += `\n`;
  }

  // Add video streams
  const audioParam = audioTracks.length > 0 ? ',AUDIO="audio"' : "";
  // Remove subtitle parameter from video streams as we're not using EXT-X-MEDIA for subtitles

  content += `# Video streams\n`;

  // Add entries for each available resolution
  const resolutionInfo: Record<
    string,
    { bandwidth: string; resolution: string; codec: string }
  > = {
    "1080p": {
      bandwidth: "8500000",
      resolution: "1920x1080",
      codec: "hev1.1.6.L153.B0",
    },
    "720p": {
      bandwidth: "5500000",
      resolution: "1280x720",
      codec: "hev1.1.6.L123.B0",
    },
    "480p": {
      bandwidth: "2500000",
      resolution: "854x480",
      codec: "hev1.1.6.L93.B0",
    },
    "360p": {
      bandwidth: "1500000",
      resolution: "640x360",
      codec: "hev1.1.6.L93.B0",
    },
  };

  for (const dir of resolutionDirs) {
    const info = resolutionInfo[dir] || {
      bandwidth: "2500000",
      resolution: `?x${dir.replace("p", "")}`,
      codec: "hev1.1.6.L123.B0",
    };

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${info.bandwidth},RESOLUTION=${info.resolution},CODECS="${info.codec},mp4a.40.2"${audioParam}\n`;
    content += `${dir}/playlist.m3u8\n\n`;
  }

  await fs.writeFile(path.join(outputDir, "master.m3u8"), content);

  // Log available subtitle files for player reference
  if (subtitleFiles.length > 0) {
    logWithTimestamp(`📝 Available subtitle files:`, chalk.cyan);
    subtitleFiles.forEach((sub) => {
      logWithTimestamp(`   - ${sub.file} (${sub.name})`, chalk.cyan);
    });
  }

  logWithTimestamp("✅ Master playlist created successfully", chalk.green);
  playlistProgress.complete("Master playlist generated");
}

async function runAll() {
  logWithTimestamp(
    "🍎 Starting macOS Apple Silicon transcoding job",
    chalk.magenta
  );

  // Ensure output directory exists
  await fs.ensureDir(outputDir);

  // Check for FFmpeg installation
  try {
    const { stdout } = await execa("ffmpeg", ["-version"]);
    logWithTimestamp(
      "✅ FFmpeg detected: " + stdout.split("\n")[0],
      chalk.green
    );
  } catch (error) {
    logWithTimestamp(
      "❌ FFmpeg not found or not working. Please install FFmpeg.",
      chalk.red
    );
    process.exit(1);
  }

  // Run all transcoding steps
  await transcodeResolutions();
  await extractAudioTracks();
  await copySubtitles();
  await writeMasterPlaylist();

  logWithTimestamp("🎉 Transcoding completed successfully!", chalk.green.bold);
  logWithTimestamp(
    "📺 Your HLS stream is ready at: " + path.join(outputDir, "master.m3u8"),
    chalk.cyan
  );
}

runAll();
