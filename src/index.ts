import dotenv from "dotenv";
dotenv.config();

import { transcoder } from "./transcoderService";
import { parseFilePath } from "./lib/pathParser";
import path from "path";
import {
  fileExists,
  toWindowsPath,
  toUnixPath,
  sanitizePathComponent,
} from "./lib/pathUtils";
import { dbOperations } from "./dbOperations";
import { TranscodeStatus } from "./lib/types";
import { invalidateCache } from "./lib/cacheInvalidation";
import fs from "fs";
import chalk from "chalk";

async function main() {
  try {
    const queuedMovies = await dbOperations.getQueuedTranscodeMovies();
    console.log("Queued movies: ", queuedMovies.length);
    const queuedSeries = await dbOperations.getQueuedTranscodeTvSeries();
    console.log("Queued TV series: ", queuedSeries.length);

    // Count total episodes across all series
    const totalEpisodes = queuedSeries.reduce(
      (total, series) => total + series.episodes.length,
      0
    );
    console.log("Total episodes to transcode: ", totalEpisodes);

    for (const [index, movie] of queuedMovies.entries()) {
      console.log(
        chalk.bgWhite.black(
          `-------TRANSCODING MOVIES: ${index + 1} of ${queuedMovies.length}-------`
        )
      );
      const parsedPath = parseFilePath(toWindowsPath(movie.filePath));
      const exists = await fileExists(parsedPath);
      if (!exists) {
        console.log("File does not exist.");
        await dbOperations.updateMovieTranscodeStatus(
          movie.id,
          TranscodeStatus.FAILED
        );
        continue;
      }

      const parentDir = path.dirname(parsedPath);
      const containerParentDir = path.dirname(movie.filePath);
      const sanitizedMovieTitle = sanitizePathComponent(`HLS ${movie.title}`);
      const outputDir = path.join(parentDir, sanitizedMovieTitle);
      const playPath = toUnixPath(
        path.join(containerParentDir, sanitizedMovieTitle, `master.m3u8`)
      );
      try {
        await dbOperations.updateMovieTranscodeStatus(
          movie.id,
          TranscodeStatus.IN_PROGRESS
        );
        if (fs.existsSync(parseFilePath(toWindowsPath(playPath)))) {
          console.log("Movie already transcoded.");
          await dbOperations.updateMovieTranscodeStatus(
            movie.id,
            TranscodeStatus.COMPLETED
          );
          await dbOperations.updateMoviePlayPath(movie.id, playPath);

          // Invalidate cache for already transcoded movie
          await invalidateCache();
          continue;
        } else {
          await transcoder(parsedPath, outputDir, movie.title);
        }
        await dbOperations.updateMovieTranscodeStatus(
          movie.id,
          TranscodeStatus.COMPLETED
        );
        await dbOperations.updateMoviePlayPath(movie.id, playPath);

        // Invalidate cache after successful movie transcode
        await invalidateCache();
      } catch (error) {
        console.error("Error transcoding movie:", error);
        await dbOperations.updateMovieTranscodeStatus(
          movie.id,
          TranscodeStatus.FAILED
        );
      }
    }

    // Process TV Series
    for (const [seriesIndex, series] of queuedSeries.entries()) {
      console.log(
        chalk.bgBlue.white(
          `-------TRANSCODING SERIES: ${seriesIndex + 1} of ${queuedSeries.length} - ${series.title}-------`
        )
      );

      try {
        await dbOperations.updateTvSeriesTranscodeStatus(
          series.id,
          TranscodeStatus.IN_PROGRESS
        );

        let seriesHasFailures = false;

        // Process each episode in the series
        for (const [episodeIndex, episode] of series.episodes.entries()) {
          console.log(
            chalk.bgWhite.black(
              `-------TRANSCODING EPISODE: ${episodeIndex + 1} of ${series.episodes.length} - S${episode.seasonNumber}E${episode.episodeNumber} ${episode.title}-------`
            )
          );

          const parsedPath = parseFilePath(toWindowsPath(episode.filePath));
          const exists = await fileExists(parsedPath);
          if (!exists) {
            console.log("Episode file does not exist.");
            await dbOperations.updateEpisodeTranscodeStatus(
              episode.id,
              TranscodeStatus.FAILED
            );
            seriesHasFailures = true;
            continue;
          }

          const parentDir = path.dirname(parsedPath);
          const containerParentDir = path.dirname(episode.filePath);
          const sanitizedSeriesTitle = sanitizePathComponent(
            `HLS ${series.title}`
          );
          const sanitizedEpisodeTitle = sanitizePathComponent(
            `HLS S${episode.seasonNumber}E${episode.episodeNumber} ${episode.title}`
          );

          const outputDir = path.join(
            parentDir,
            sanitizedSeriesTitle,
            sanitizedEpisodeTitle
          );
          const playPath = toUnixPath(
            path.join(
              containerParentDir,
              sanitizedSeriesTitle,
              sanitizedEpisodeTitle,
              `master.m3u8`
            )
          );

          try {
            await dbOperations.updateEpisodeTranscodeStatus(
              episode.id,
              TranscodeStatus.IN_PROGRESS
            );

            if (fs.existsSync(parseFilePath(toWindowsPath(playPath)))) {
              console.log("Episode already transcoded.");
              await dbOperations.updateEpisodeTranscodeStatus(
                episode.id,
                TranscodeStatus.COMPLETED
              );
              await dbOperations.updateEpisodePlayPath(episode.id, playPath);

              // Invalidate cache for already transcoded episode
              await invalidateCache();
              continue;
            } else {
              await transcoder(
                parsedPath,
                outputDir,
                `${series.title} S${episode.seasonNumber}E${episode.episodeNumber} ${episode.title}`
              );
            }

            await dbOperations.updateEpisodeTranscodeStatus(
              episode.id,
              TranscodeStatus.COMPLETED
            );
            await dbOperations.updateEpisodePlayPath(episode.id, playPath);

            // Invalidate cache after successful episode transcode
            await invalidateCache();
          } catch (error) {
            console.error("Error transcoding episode:", error);
            await dbOperations.updateEpisodeTranscodeStatus(
              episode.id,
              TranscodeStatus.FAILED
            );
            seriesHasFailures = true;
          }
        }

        // Check if all episodes in the series are completed
        const allEpisodesCompleted =
          await dbOperations.checkAllEpisodesCompleted(series.id);

        if (allEpisodesCompleted && !seriesHasFailures) {
          await dbOperations.updateTvSeriesTranscodeStatus(
            series.id,
            TranscodeStatus.COMPLETED
          );
          console.log(
            chalk.green(
              `✅ Series "${series.title}" transcoding completed successfully!`
            )
          );
        } else {
          await dbOperations.updateTvSeriesTranscodeStatus(
            series.id,
            TranscodeStatus.FAILED
          );
          console.log(
            chalk.red(
              `❌ Series "${series.title}" transcoding failed or incomplete.`
            )
          );
        }
      } catch (error) {
        console.error("Error transcoding series:", error);
        await dbOperations.updateTvSeriesTranscodeStatus(
          series.id,
          TranscodeStatus.FAILED
        );
      }
    }
  } catch (error) {
    console.error("Error transcoding:", error);
  } finally {
    console.log("All Queued Transcoding Task Completed.");
  }
}

// async function markPending() {
//   await dbOperations.markAllAsPending();
// }

// markPending().catch(console.error);
// console.log(typeof main);
main().catch(console.error);
