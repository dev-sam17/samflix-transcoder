import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";
import * as cliProgress from "cli-progress";

const input = "dragon.mkv";
const outputDir = "output";

// Timestamp helper function
function getTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Enhanced logging with timestamps
function logWithTimestamp(message: string, color: any = chalk.white) {
  console.log(color(`[${getTimestamp()}] ${message}`));
}

// Progress bar helper functions using cli-progress
function createProgressBar(title: string, total: number = 100) {
  const bar = new cliProgress.SingleBar(
    {
      format: `${chalk.cyan(title)} |${chalk.cyan(
        "{bar}"
      )}| {percentage}% | ETA: {eta}s | {value}/{total} | {status}`,
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
      etaBuffer: 50,
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(total, 0, { status: "Starting..." });

  const startTime = Date.now();

  return {
    update: (value: number, status?: string) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = value / elapsed;
      const remaining = total - value;
      const eta = rate > 0 ? Math.round(remaining / rate) : 0;

      bar.update(value, {
        status: status || "Processing...",
        eta: eta,
      });
    },
    complete: (status?: string) => {
      bar.update(total, { status: status || "Complete" });
      bar.stop();
      logWithTimestamp(`✅ ${title} completed`, chalk.green);
    },
    fail: (status?: string) => {
      bar.stop();
      logWithTimestamp(
        `❌ ${title} failed: ${status || "Unknown error"}`,
        chalk.red
      );
    },
  };
}

function showStep(stepNumber: number, title: string, description?: string) {
  console.log(
    `\n${chalk.bgBlue.white(` STEP ${stepNumber} `)} ${chalk.bold.white(title)}`
  );
  if (description) {
    logWithTimestamp(description, chalk.yellow);
  }
  console.log();
}

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

      progress.update(20, "Starting GPU transcoding...");

      // Attempt GPU-accelerated encoding
      try {
        const gpuArgs = [
          "-y",
          "-i",
          input,
          "-c:v",
          "hevc_nvenc",
          "-preset",
          "p7", // highest compression
          "-tune",
          "hq", // high quality tuning
          "-rc",
          "vbr",
          "-cq",
          resolution.crf.toString(),
          "-maxrate",
          resolution.maxrate,
          "-bufsize",
          resolution.bufsize,
          "-vf",
          `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
          "-f",
          "hls",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          path.join(outputPath, "segment_%03d.ts"),
          path.join(outputPath, "stream.m3u8"),
        ];

        progress.update(30, "GPU encoding in progress...");
        const gpuProcess = execa("ffmpeg", gpuArgs);

        let currentProgress = 30;
        const progressInterval = setInterval(() => {
          currentProgress = Math.min(currentProgress + Math.random() * 5, 90);
          progress.update(currentProgress, "GPU encoding...");
        }, 2000);

        await gpuProcess;
        clearInterval(progressInterval);
        progress.complete("GPU transcoding successful");
        logWithTimestamp(
          `✓ Transcoded ${resolution.name} using GPU`,
          chalk.green
        );
      } catch (gpuError) {
        progress.update(40, "GPU failed, switching to CPU...");
        logWithTimestamp(
          `⚠ GPU failed for ${resolution.name}, using CPU`,
          chalk.yellow
        );

        const cpuArgs = [
          "-y",
          "-i",
          input,
          "-c:v",
          "libx265",
          "-preset",
          "veryslow", // Changed from slow to veryslow for better compression
          "-tune",
          "zerolatency", // Optimize for compression
          "-crf",
          resolution.crf.toString(),
          "-maxrate",
          resolution.maxrate,
          "-bufsize",
          resolution.bufsize,
          "-vf",
          `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
          "-f",
          "hls",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_filename",
          path.join(outputPath, "segment_%03d.ts"),
          path.join(outputPath, "stream.m3u8"),
        ];

        progress.update(50, "CPU encoding in progress...");
        const cpuProcess = execa("ffmpeg", cpuArgs);

        const progressInterval = setInterval(() => {
          progress.update(Math.random() * 40 + 50, "CPU encoding...");
        }, 2000);

        await cpuProcess;
        clearInterval(progressInterval);
        progress.complete("CPU transcoding successful");
        logWithTimestamp(
          `✓ Transcoded ${resolution.name} with CPU`,
          chalk.green
        );
      }
    } catch (error) {
      progress.fail(`Failed to transcode ${resolution.name}: ${error}`);
      throw error;
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

      // Determine language from stream tags or default to a language based on index
      let language = "und"; // Default to undefined language
      let languageName: { name: string; code: string; default: boolean } = {
        name: "Unknown",
        code: "unknown",
        default: false,
      };

      if (stream.tags && stream.tags.language) {
        language = stream.tags.language.toLowerCase();

        // Map common language codes to names
        const languageMap: Record<
          string,
          { name: string; code: string; default: boolean }
        > = {
          en: { name: "English", code: "en", default: true },
          eng: { name: "English", code: "en", default: true },
          hi: { name: "Hindi", code: "hi", default: false },
          hin: { name: "Hindi", code: "hi", default: false },
          fr: { name: "French", code: "fr", default: false },
          fre: { name: "French", code: "fr", default: false },
          es: { name: "Spanish", code: "es", default: false },
          spa: { name: "Spanish", code: "es", default: false },
          de: { name: "German", code: "de", default: false },
          ger: { name: "German", code: "de", default: false },
          ja: { name: "Japanese", code: "ja", default: false },
          jpn: { name: "Japanese", code: "ja", default: false },
          ta: { name: "Tamil", code: "ta", default: false },
          tam: { name: "Tamil", code: "ta", default: false },
          te: { name: "Telugu", code: "te", default: false },
          tel: { name: "Telugu", code: "te", default: false },
          mal: { name: "Malayalam", code: "ml", default: false },
          ml: { name: "Malayalam", code: "ml", default: false },
          guj: { name: "Gujarati", code: "gu", default: false },
          gu: { name: "Gujarati", code: "gu", default: false },
          kann: { name: "Kannada", code: "kn", default: false },
          kan: { name: "Kannada", code: "kn", default: false },
          ori: { name: "Oriya", code: "or", default: false },
          pan: { name: "Punjabi", code: "pa", default: false },
          sinh: { name: "Sinhala", code: "si", default: false },
          sin: { name: "Sinhala", code: "si", default: false },
        };

        languageName = languageMap[language] || {
          name: language.charAt(0).toUpperCase() + language.slice(1),
          code: language.substring(0, 2),
          default: false,
        };
      } else {
        // If no language tag, make assumptions based on stream index
        if (i === 0) {
          language = "eng";
          languageName = { name: "English", code: "en", default: true };
        } else if (i === 1) {
          language = "hin";
          languageName = { name: "Hindi", code: "hi", default: false };
        } else {
          language = `audio${i}`;
          languageName = {
            name: `Audio ${i + 1}`,
            code: `audio${i}`,
            default: false,
          };
        }
      }

      const audioProgress = createProgressBar(
        `Extracting ${languageName.name} audio`,
        100
      );

      // Create language-specific directory
      const languageDir = path.join(audioBaseDir, language);
      await fs.ensureDir(languageDir);

      // Create output filename based on language
      const outputFile = path
        .join(languageDir, "audio.m4a")
        .replace(/\\/g, "/");
      const hlsFile = path
        .join(languageDir, "playlist.m3u8")
        .replace(/\\/g, "/");
      const segmentFile = path
        .join(languageDir, "segment_%03d.ts")
        .replace(/\\/g, "/");

      try {
        audioProgress.update(20, "Extracting audio stream...");

        // Extract the audio stream with proper HLS-compatible settings
        const extractProcess = execa("ffmpeg", [
          "-y",
          "-i",
          input,
          "-map",
          `0:${streamIndex}`,
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ar",
          "48000", // Ensure consistent sample rate
          "-ac",
          "2", // Stereo output
          "-profile:a",
          "aac_low", // AAC-LC profile for better compatibility
          outputFile,
        ]);

        // Simulate progress for extraction
        const extractInterval = setInterval(() => {
          audioProgress.update(Math.random() * 30 + 20, "Extracting...");
        }, 1000);

        await extractProcess;
        clearInterval(extractInterval);

        audioProgress.update(60, "Converting to HLS...");

        // Convert to HLS with TS segments for better compatibility
        const hlsProcess = execa("ffmpeg", [
          "-y",
          "-i",
          outputFile,
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "hls",
          "-hls_time",
          "6",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_type",
          "mpegts", // Use MPEG-TS segments instead of raw AAC
          "-hls_segment_filename",
          segmentFile,
          "-hls_flags",
          "independent_segments", // Better seeking support
          hlsFile,
        ]);

        // Simulate progress for HLS conversion
        const hlsInterval = setInterval(() => {
          audioProgress.update(Math.random() * 30 + 60, "Converting to HLS...");
        }, 1000);

        await hlsProcess;
        clearInterval(hlsInterval);

        audioProgress.complete("Extraction successful");
        logWithTimestamp(
          `✓ Successfully extracted ${languageName.name} audio`,
          chalk.green
        );
      } catch (error) {
        audioProgress.fail(
          `Failed to process ${languageName.name} audio: ${error}`
        );
      }
    }
  } catch (error) {
    analysisProgress.fail(`Error analyzing audio streams: ${error}`);
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
          let language = "unknown";
          let languageName: { name: string; code: string; default: boolean } = {
            name: "Unknown",
            code: "unknown",
            default: false,
          };

          if (stream.tags && stream.tags.language) {
            language = stream.tags.language.toLowerCase();
          }

          // Map language codes to full names (same mapping as audio)
          const languageMap: Record<
            string,
            { name: string; code: string; default: boolean }
          > = {
            en: { name: "English", code: "en", default: true },
            hin: { name: "Hindi", code: "hi", default: false },
            fre: { name: "French", code: "fr", default: false },
            spa: { name: "Spanish", code: "es", default: false },
            ger: { name: "German", code: "de", default: false },
            jpn: { name: "Japanese", code: "ja", default: false },
          };

          languageName = languageMap[language] || {
            name: language.charAt(0).toUpperCase() + language.slice(1),
            code: language.substring(0, 2),
            default: false,
          };

          const extractProgress = createProgressBar(
            `Extracting ${languageName.name} subtitles`,
            100
          );

          try {
            extractProgress.update(20, "Starting extraction...");

            const outputFile = path.join(outputDir, `subs_${language}.vtt`);

            // Extract subtitle stream and convert to WebVTT format
            const extractProcess = execa("ffmpeg", [
              "-y",
              "-i",
              input,
              "-map",
              `0:s:${i}`, // Map the specific subtitle stream
              "-c:s",
              "webvtt", // Convert to WebVTT format for HLS
              outputFile,
            ]);

            // Simulate progress for extraction
            const extractInterval = setInterval(() => {
              extractProgress.update(Math.random() * 60 + 20, "Extracting...");
            }, 1000);

            await extractProcess;
            clearInterval(extractInterval);

            extractProgress.complete("Extraction successful");
            logWithTimestamp(
              `✓ Successfully extracted ${languageName.name} embedded subtitles`,
              chalk.green
            );

            embeddedSubtitles.push({
              file: `subs_${language}.vtt`,
              language,
              name: languageName.name,
            });
          } catch (error) {
            extractProgress.fail(
              `Failed to extract ${languageName.name} subtitles: ${error}`
            );
          }
        }
      }
    }
  } catch (error) {
    logWithTimestamp(
      `✗ Error analyzing embedded subtitles: ${error}`,
      chalk.red
    );
  }

  // If we found embedded subtitles, we're done
  if (embeddedSubtitles.length > 0) {
    subtitleProgress.complete(
      `Extracted ${embeddedSubtitles.length} embedded subtitle(s)`
    );
    return embeddedSubtitles;
  }

  // If no embedded subtitles found, fall back to external subtitle files
  subtitleProgress.update(
    60,
    "No embedded subtitles found, checking external files..."
  );
  logWithTimestamp(
    "⚠ No embedded subtitles found, checking for external subtitle files...",
    chalk.yellow
  );

  // Define potential external subtitle files to check
  const externalSubtitleFiles = [
    { file: "subs_eng.vtt", language: "eng", name: "English" },
    { file: "subs_hin.vtt", language: "hin", name: "Hindi" },
    { file: "subs_fre.vtt", language: "fre", name: "French" },
    { file: "subs_spa.vtt", language: "spa", name: "Spanish" },
    { file: "subs_ger.vtt", language: "ger", name: "German" },
    { file: "subs_jpn.vtt", language: "jpn", name: "Japanese" },
    { file: "subs_tam.vtt", language: "tam", name: "Tamil" },
    { file: "subs_tel.vtt", language: "tel", name: "Telugu" },
    { file: "subs_mal.vtt", language: "mal", name: "Malayalam" },
    { file: "subs_guj.vtt", language: "guj", name: "Gujarati" },
    { file: "subs_kan.vtt", language: "kan", name: "Kannada" },
  ];

  // Track which external subtitle files were successfully copied
  const copiedSubtitles = [];
  let processedCount = 0;

  // Try to copy each external subtitle file if it exists
  for (const subtitle of externalSubtitleFiles) {
    try {
      if (await fs.pathExists(subtitle.file)) {
        subtitleProgress.update(
          70 + (processedCount / externalSubtitleFiles.length) * 25,
          `Copying ${subtitle.name}...`
        );

        await fs.copyFile(subtitle.file, path.join(outputDir, subtitle.file));
        logWithTimestamp(
          `✓ Copied ${subtitle.name} external subtitles`,
          chalk.green
        );
        copiedSubtitles.push(subtitle);
      }
    } catch (error) {
      logWithTimestamp(
        `✗ Error copying ${subtitle.name} subtitles: ${error}`,
        chalk.red
      );
    }
    processedCount++;
  }

  if (copiedSubtitles.length === 0) {
    subtitleProgress.complete("No subtitle files found");
    logWithTimestamp(
      "⚠ No external subtitle files found either.",
      chalk.yellow
    );
  } else {
    subtitleProgress.complete(
      `Copied ${copiedSubtitles.length} external subtitle file(s)`
    );
  }

  return copiedSubtitles;
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
    content += `${dir}/stream.m3u8\n\n`;
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
  await fs.ensureDir(outputDir);
  await transcodeResolutions();
  await extractAudioTracks();
  await copySubtitles();
  await writeMasterPlaylist();
}

runAll();
