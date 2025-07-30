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
import {
  getPendingTranscodeMovies,
  getPendingTranscodeEpisodes,
  updateMovieTranscodeStatus,
  updateMoviePlayPath,
  updateEpisodeTranscodeStatus,
  updateEpisodePlayPath,
  // markAllAsPending,
} from "./dbOperations";
import { TranscodeStatus } from "./lib/types";
import fs from "fs";
import chalk from "chalk";

async function main() {
  try {
    const pendingMovies = await getPendingTranscodeMovies();
    console.log("Pending movies: ", pendingMovies.length);
    const pendingEpisodes = await getPendingTranscodeEpisodes();
    console.log("Pending episodes: ", pendingEpisodes.length);

    for (const [index, movie] of pendingMovies.entries()) {
      console.log(
        chalk.bgWhite.black(
          `-------TRANSCODING MOVIES: ${index + 1} of ${pendingMovies.length}-------`
        )
      );
      const parsedPath = parseFilePath(toWindowsPath(movie.filePath));
      const exists = await fileExists(parsedPath);
      if (!exists) {
        console.log("File does not exist.");
        await updateMovieTranscodeStatus(movie.id, TranscodeStatus.FAILED);
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
        await updateMovieTranscodeStatus(movie.id, TranscodeStatus.IN_PROGRESS);
        if (fs.existsSync(parseFilePath(toWindowsPath(playPath)))) {
          console.log("Movie already transcoded.");
          await updateMovieTranscodeStatus(movie.id, TranscodeStatus.COMPLETED);
          await updateMoviePlayPath(movie.id, playPath);
          continue;
        } else {
          await transcoder(parsedPath, outputDir, movie.title);
        }
        await updateMovieTranscodeStatus(movie.id, TranscodeStatus.COMPLETED);
        await updateMoviePlayPath(movie.id, playPath);
      } catch (error) {
        console.error("Error transcoding movie:", error);
        await updateMovieTranscodeStatus(movie.id, TranscodeStatus.FAILED);
      }
    }

    for (const [index, episode] of pendingEpisodes.entries()) {
      console.log(
        chalk.bgWhite.black(
          `-------TRANSCODING EPISODES: ${index + 1} of ${pendingEpisodes.length}-------`
        )
      );
      const parsedPath = parseFilePath(toWindowsPath(episode.filePath));
      const exists = await fileExists(parsedPath);
      if (!exists) {
        console.log("File does not exist.");
        await updateEpisodeTranscodeStatus(episode.id, TranscodeStatus.FAILED);
        continue;
      }

      const parentDir = path.dirname(parsedPath);
      const containerParentDir = path.dirname(episode.filePath);
      const sanitizedSeriesTitle = sanitizePathComponent(
        `HLS ${episode.series.title}`
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
        await updateEpisodeTranscodeStatus(
          episode.id,
          TranscodeStatus.IN_PROGRESS
        );
        if (fs.existsSync(parseFilePath(toWindowsPath(playPath)))) {
          console.log("Episode already transcoded.");
          await updateEpisodeTranscodeStatus(
            episode.id,
            TranscodeStatus.COMPLETED
          );
          await updateEpisodePlayPath(episode.id, playPath);
          continue;
        } else {
          await transcoder(
            parsedPath,
            outputDir,
            `${episode.series.title} ${episode.seasonNumber} ${episode.episodeNumber}`
          );
        }
        await updateEpisodeTranscodeStatus(
          episode.id,
          TranscodeStatus.COMPLETED
        );
        await updateEpisodePlayPath(episode.id, playPath);
      } catch (error) {
        console.error("Error transcoding episode:", error);
        await updateEpisodeTranscodeStatus(episode.id, TranscodeStatus.FAILED);
      }
    }
  } catch (error) {
    console.error("Error transcoding:", error);
  } finally {
    console.log("All Queued Transcoding Task Completed.");
  }
}

// async function markPending() {
//   await markAllAsPending();
// }

// markPending().catch(console.error);
// console.log(typeof main);
main().catch(console.error);
