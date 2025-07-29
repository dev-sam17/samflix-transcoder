import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";
import { logWithTimestamp } from "./lib/utils";
import { createProgressBar } from "./lib/utils";
import { showStep } from "./lib/utils";

export async function getVideoResolution(input: string) {
  const progress = createProgressBar("Detecting video resolution", 100);

  try {
    progress.update(20, "Running ffprobe...");

    // Use ffprobe to get information about the video stream
    const { stdout: videoInfo } = await execa(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        input,
      ],
      { reject: false }
    );

    progress.update(60, "Parsing video data...");

    // Parse the JSON output
    const videoData = JSON.parse(videoInfo);
    const videoStream = videoData.streams?.[0];

    if (!videoStream) {
      progress.fail("No video stream found");
      throw new Error("No video stream found in the input file");
    }

    const width = videoStream.width;
    const height = videoStream.height;

    progress.complete(`Detected resolution: ${width}x${height}`);
    logWithTimestamp(
      `📊 Detected video resolution: ${width}x${height}`,
      chalk.blue
    );

    return { width, height };
  } catch (error) {
    progress.fail(`Failed to detect video resolution: ${error}`);
    throw error;
  }
}

export async function transcodeResolutions(input: string, outputDir: string) {
  showStep(1, "Video Transcoding", "Converting video to multiple resolutions");

  // Get the video resolution
  const { width, height } = await getVideoResolution(input);

  // Define all possible resolutions - removed 4K option for HLS compatibility
  const allResolutions = [
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

  // Determine which resolutions to use based on the source resolution
  let resolutions = [];

  if (height >= 2160 || width >= 3840) {
    // 4K source - transcode to 1080p only (removed 4K option due to HLS player compatibility issues)
    logWithTimestamp(
      `⚠️ 4K source detected but transcoding to 1080p only for HLS compatibility`,
      chalk.yellow
    );
    resolutions = allResolutions.filter((res) => res.name === "1080p");
  } else if (height >= 1080 || width >= 1920) {
    // 1080p source - transcode to 1080p only
    resolutions = allResolutions.filter((res) => res.name === "1080p");
  } else if (height >= 720 || width >= 1280) {
    // 720p source - transcode to 720p only
    resolutions = allResolutions.filter((res) => res.name === "720p");
  } else {
    // Lower resolution source - use the closest matching resolution
    const sourceRes =
      allResolutions.find((res) => res.height <= height) ||
      allResolutions[allResolutions.length - 1];
    resolutions = [sourceRes];
  }

  logWithTimestamp(
    `🎬 Will transcode to the following resolutions: ${resolutions
      .map((r) => r.name)
      .join(", ")}`,
    chalk.green
  );

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

export async function extractAudioTracks(input: string, outputDir: string) {
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
          ko: { name: "Korean", code: "ko", default: false },
          korean: { name: "Korean", code: "ko", default: false },
          zh: { name: "Chinese", code: "zh", default: false },
          chi: { name: "Chinese", code: "chi", default: false },
          chinese: { name: "Chinese", code: "chi", default: false },
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

        if (
          !(
            language === "hin" ||
            language === "eng" ||
            language == "hi" ||
            language == "en" ||
            language == "und" ||
            language == "ja" ||
            language == "jpn" ||
            language == "ko" ||
            language == "korean" ||
            language == "zh" ||
            language == "chi" ||
            language == "chinese"
          )
        ) {
          continue;
        }

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

export async function copySubtitles(input: string, outputDir: string) {
  showStep(
    3,
    "Subtitle Processing",
    "Checking embedded and external subtitles"
  );

  const subtitleProgress = createProgressBar("Processing subtitles", 100);

  subtitleProgress.update(10, "Analyzing embedded subtitles...");

  // First, check for embedded subtitles in the input file
  const embeddedSubtitles: Array<{
    file: string;
    language: string;
    name: string;
  }> = [];
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
          // const streamIndex = stream.index;

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
            eng: { name: "English", code: "eng", default: true },
            hin: { name: "Hindi", code: "hin", default: false },
            hi: { name: "Hindi", code: "hi", default: false },
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

            if (
              !(
                language === "und" ||
                language === "en" ||
                language === "eng" ||
                language === "hin" ||
                language === "hi"
              )
            ) {
              continue;
            }

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

  // Track all found subtitles
  const allSubtitles = [...embeddedSubtitles];

  // If embedded subtitles were found, log them but continue to check for external subtitles
  if (embeddedSubtitles.length > 0) {
    logWithTimestamp(
      `✓ Found ${embeddedSubtitles.length} embedded subtitle(s), continuing to check for external subtitles`,
      chalk.green
    );
  } else {
    // If no embedded subtitles found, log that we're checking external subtitle files
    subtitleProgress.update(
      60,
      "No embedded subtitles found, checking external files..."
    );
    logWithTimestamp(
      "⚠ No embedded subtitles found, checking for external subtitle files...",
      chalk.yellow
    );
  }

  // Get the parent directory of the input file
  const inputDir = path.dirname(input);
  const parentDir = path.dirname(inputDir);
  const inputFileName = path.basename(input, path.extname(input));

  subtitleProgress.update(65, "Checking parent folder for .srt files...");

  // 1. Check for .srt files in the parent folder
  try {
    const parentDirFiles = await fs.readdir(parentDir);
    const srtFiles = parentDirFiles.filter((file) =>
      file.toLowerCase().endsWith(".srt")
    );

    if (srtFiles.length > 0) {
      logWithTimestamp(
        `📊 Found ${srtFiles.length} .srt file(s) in parent folder`,
        chalk.blue
      );

      // Process the first .srt file found in parent directory as English default subtitle
      if (srtFiles.length > 0) {
        const srtFile = srtFiles[0]; // Take the first .srt file
        const srtPath = path.join(parentDir, srtFile);

        // Always treat the .srt file in parent directory as English, regardless of name
        const language = "eng";
        const name = "English";

        const outputVttFile = `subs_${language}.vtt`;
        const outputVttPath = path.join(outputDir, outputVttFile);

        // Create a temporary SRT file with adjusted timing
        const tempSrtPath = path.join(outputDir, "temp_adjusted.srt");

        try {
          subtitleProgress.update(
            70,
            `Converting ${srtFile} to VTT format with timing adjustment...`
          );

          // First, read the SRT file content
          const srtContent = await fs.readFile(srtPath, "utf8");

          // Process SRT content to add delay (0.5 seconds = 500ms)
          const delayMs = 375;
          const adjustedSrtContent = adjustSubtitleTiming(srtContent, delayMs);

          // Write the adjusted content to temp file
          await fs.writeFile(tempSrtPath, adjustedSrtContent);

          // Convert the adjusted SRT to VTT
          await execa("ffmpeg", [
            "-y",
            "-i",
            tempSrtPath,
            "-c:s",
            "webvtt",
            "-metadata:s:s:0",
            "language=eng",
            outputVttPath,
          ]);

          // Clean up temp file
          await fs.remove(tempSrtPath);

          logWithTimestamp(
            `✓ Converted ${srtFile} to VTT format with timing adjustment`,
            chalk.green
          );
          logWithTimestamp(`✓ Set as default English subtitle`, chalk.green);

          allSubtitles.push({
            file: outputVttFile,
            language,
            name,
          });
        } catch (error) {
          logWithTimestamp(
            `✗ Error converting ${srtFile} to VTT: ${error}`,
            chalk.red
          );
          // Clean up temp file if it exists
          try {
            if (await fs.pathExists(tempSrtPath)) {
              await fs.remove(tempSrtPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }

      // Skip processing other .srt files in parent directory since we've already set the default
    }
  } catch (error) {
    logWithTimestamp(
      `✗ Error checking parent folder for .srt files: ${error}`,
      chalk.red
    );
  }

  // 2. Check for "subs" or "Subs" directory in the parent folder
  subtitleProgress.update(80, "Checking for subs directory...");

  const possibleSubDirs = ["subs", "Subs", "subtitles", "Subtitles"];

  for (const subDir of possibleSubDirs) {
    const subDirPath = path.join(parentDir, subDir);

    try {
      if (await fs.pathExists(subDirPath)) {
        logWithTimestamp(
          `📊 Found subtitles directory: ${subDirPath}`,
          chalk.blue
        );

        const subDirFiles = await fs.readdir(subDirPath);
        const srtFiles = subDirFiles.filter((file) =>
          file.toLowerCase().endsWith(".srt")
        );

        if (srtFiles.length > 0) {
          logWithTimestamp(
            `📊 Found ${srtFiles.length} .srt file(s) in ${subDir} directory`,
            chalk.blue
          );

          // Process each .srt file
          for (const srtFile of srtFiles) {
            const srtPath = path.join(subDirPath, srtFile);
            const baseName = path.basename(srtFile, ".srt");

            // Determine language from filename
            let language = "unknown";
            let name = "Unknown";

            // Check if it's an English subtitle or has the same name as the input file
            if (
              baseName.toLowerCase().includes("eng") ||
              baseName.toLowerCase().includes("en") ||
              baseName.toLowerCase().includes("english") ||
              baseName === inputFileName
            ) {
              language = "eng";
              name = "English";
            }

            const outputVttFile = `subs_${language}.vtt`;
            const outputVttPath = path.join(outputDir, outputVttFile);

            // Convert .srt to .vtt
            try {
              subtitleProgress.update(
                85,
                `Converting ${srtFile} to VTT format...`
              );

              await execa("ffmpeg", ["-y", "-i", srtPath, outputVttPath]);

              logWithTimestamp(
                `✓ Converted ${srtFile} to VTT format`,
                chalk.green
              );

              allSubtitles.push({
                file: outputVttFile,
                language,
                name,
              });
            } catch (error) {
              logWithTimestamp(
                `✗ Error converting ${srtFile} to VTT: ${error}`,
                chalk.red
              );
            }
          }
        }
      }
    } catch (error) {
      logWithTimestamp(
        `✗ Error checking ${subDir} directory: ${error}`,
        chalk.red
      );
    }
  }

  // 3. Finally, check for predefined external subtitle files in the current directory
  subtitleProgress.update(
    90,
    "Checking for predefined external subtitle files..."
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
  let processedCount = 0;

  // Try to copy each external subtitle file if it exists
  for (const subtitle of externalSubtitleFiles) {
    try {
      if (await fs.pathExists(subtitle.file)) {
        subtitleProgress.update(
          95 + (processedCount / externalSubtitleFiles.length) * 5,
          `Copying ${subtitle.name}...`
        );

        await fs.copyFile(subtitle.file, path.join(outputDir, subtitle.file));
        logWithTimestamp(
          `✓ Copied ${subtitle.name} external subtitles`,
          chalk.green
        );
        allSubtitles.push(subtitle);
      }
    } catch (error) {
      logWithTimestamp(
        `✗ Error copying ${subtitle.name} subtitles: ${error}`,
        chalk.red
      );
    }
    processedCount++;
  }

  if (allSubtitles.length === 0) {
    subtitleProgress.complete("No subtitle files found");
    logWithTimestamp("⚠ No subtitle files found.", chalk.yellow);
  } else {
    subtitleProgress.complete(`Found ${allSubtitles.length} subtitle file(s)`);
  }

  // Create individual M3U8 playlist files for each subtitle track
  for (const sub of allSubtitles) {
    // Verify the VTT file exists
    const vttPath = path.join(outputDir, sub.file);
    if (await fs.pathExists(vttPath)) {
      // Read the VTT file to check its content
      const vttContent = await fs.readFile(vttPath, "utf8");

      // Process VTT content to ensure proper formatting
      let processedVttContent = vttContent;

      // If the VTT file doesn't have WEBVTT header, add it
      if (!processedVttContent.trim().startsWith("WEBVTT")) {
        processedVttContent = `WEBVTT\n\n${processedVttContent}`;
      }

      // Write back the processed VTT file
      await fs.writeFile(vttPath, processedVttContent);

      // Create a simple playlist with the single VTT file
      const playlistContent = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:1.000,
${sub.file}
#EXT-X-ENDLIST
`;
      const playlistFileName = `subs_${sub.language}.m3u8`;
      await fs.writeFile(
        path.join(outputDir, playlistFileName),
        playlistContent
      );

      logWithTimestamp(
        `✓ Created subtitle playlist for ${sub.name}`,
        chalk.green
      );
    } else {
      logWithTimestamp(
        `⚠ VTT file ${sub.file} not found, skipping playlist creation`,
        chalk.yellow
      );
    }
  }

  return allSubtitles;
}

export async function writeMasterPlaylist(outputDir: string) {
  showStep(4, "Master Playlist Generation", "Creating dynamic master playlist");

  const playlistProgress = createProgressBar("Generating master playlist", 100);

  playlistProgress.update(20, "Scanning audio directory...");

  // Check which audio tracks are available by scanning the audio directory
  const audioBaseDir = path.join(outputDir, "audio");
  const audioTracks: Array<{
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
  const allSubtitleFiles = (await fs.readdir(outputDir))
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
        nor: { name: "Norwegian", code: "no", default: false },
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

  // Filter to include only English and Hindi subtitles
  const subtitleFiles = allSubtitleFiles.filter(
    (sub) => sub.language === "eng" || sub.language === "hin"
  );

  // Ensure English is default if present, otherwise make the first one default
  if (subtitleFiles.length > 0) {
    const englishSub = subtitleFiles.find((sub) => sub.language === "eng");
    if (englishSub) {
      englishSub.default = true;
      // Make sure other subtitles are not default
      subtitleFiles.forEach((sub) => {
        if (sub.language !== "eng") {
          sub.default = false;
        }
      });
    } else {
      // If no English, make the first one default
      subtitleFiles[0].default = true;
    }
  }

  // Create individual M3U8 playlist files for each subtitle track
  for (const sub of subtitleFiles) {
    const playlistContent = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:1.000,
${sub.file}
#EXT-X-ENDLIST
`;
    const playlistFileName = `subs_${sub.language}.m3u8`;
    await fs.writeFile(path.join(outputDir, playlistFileName), playlistContent);
  }

  // Check which video resolutions are available
  const resolutionDirs = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory() && dirent.name.endsWith("p"))
    .map((dirent) => dirent.name);

  // Build the master playlist dynamically based on available tracks
  let content = `#EXTM3U\n\n`;

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

  // Add subtitle tracks if they exist
  if (subtitleFiles.length > 0) {
    content += `# Subtitle tracks\n`;
    for (const sub of subtitleFiles) {
      const playlistFileName = `subs_${sub.language}.m3u8`;
      content += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${
        sub.name
      }",LANGUAGE="${sub.code}",URI="${playlistFileName}",DEFAULT=${
        sub.default ? "YES" : "NO"
      },AUTOSELECT=YES\n`;
    }
    content += `\n`;
  }

  // Add video streams
  const audioParam = audioTracks.length > 0 ? ',AUDIO="audio"' : "";
  const subtitleParam = subtitleFiles.length > 0 ? ',SUBTITLES="subs"' : "";

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

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${info.bandwidth},RESOLUTION=${info.resolution},CODECS="${info.codec},mp4a.40.2"${audioParam}${subtitleParam}\n`;
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

function adjustSubtitleTiming(srtContent: string, delayMs: number): string {
  // Split the SRT content into subtitle blocks
  const blocks = srtContent
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim() !== "");

  // Process each subtitle block
  const adjustedBlocks = blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) return block; // Skip invalid blocks

    // Find the timing line (second line in each block)
    const timingLine = lines[1];
    const timingMatch = timingLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/
    );

    if (!timingMatch) return block; // Skip if timing format doesn't match

    // Extract start and end times
    const startTime = timingMatch[1];
    const endTime = timingMatch[2];

    // Add delay to both start and end times
    const adjustedStartTime = addDelay(startTime, delayMs);
    const adjustedEndTime = addDelay(endTime, delayMs);

    // Replace the timing line
    lines[1] = `${adjustedStartTime} --> ${adjustedEndTime}`;

    // Reconstruct the block
    return lines.join("\n");
  });

  // Join the blocks back together
  return adjustedBlocks.join("\n\n");
}

function addDelay(timeStr: string, delayMs: number): string {
  // Parse the time string (format: HH:MM:SS,mmm)
  const [timepart, mspart] = timeStr.split(",");
  const [hours, minutes, seconds] = timepart.split(":").map(Number);
  const ms = parseInt(mspart);

  // Convert to total milliseconds
  let totalMs =
    ms + seconds * 1000 + minutes * 60 * 1000 + hours * 60 * 60 * 1000;

  // Add delay
  totalMs += delayMs;

  // Convert back to HH:MM:SS,mmm format
  const newHours = Math.floor(totalMs / (60 * 60 * 1000));
  totalMs %= 60 * 60 * 1000;
  const newMinutes = Math.floor(totalMs / (60 * 1000));
  totalMs %= 60 * 1000;
  const newSeconds = Math.floor(totalMs / 1000);
  const newMs = totalMs % 1000;

  // Format with leading zeros
  const formattedHours = newHours.toString().padStart(2, "0");
  const formattedMinutes = newMinutes.toString().padStart(2, "0");
  const formattedSeconds = newSeconds.toString().padStart(2, "0");
  const formattedMs = newMs.toString().padStart(3, "0");

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds},${formattedMs}`;
}
