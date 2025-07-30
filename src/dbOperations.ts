import { prisma } from "@dev-sam17/prisma-client-for-samflix";
import { TranscodeStatus } from "./lib/types";

export async function updateMovieTranscodeStatus(
  movieId: string,
  status: TranscodeStatus
) {
  try {
    await prisma.movie.update({
      where: {
        id: movieId,
      },
      data: {
        transcodeStatus: status,
      },
    });
  } catch (error) {
    console.error("Error updating movie transcode status:", error);
    throw error;
  }
}

export async function updateEpisodeTranscodeStatus(
  episodeId: string,
  status: TranscodeStatus
) {
  try {
    await prisma.episode.update({
      where: {
        id: episodeId,
      },
      data: {
        transcodeStatus: status,
      },
    });
  } catch (error) {
    console.error("Error updating episode transcode status:", error);
    throw error;
  }
}

export async function updateMoviePlayPath(movieId: string, playPath: string) {
  try {
    await prisma.movie.update({
      where: {
        id: movieId,
      },
      data: {
        playPath,
      },
    });
  } catch (error) {
    console.error("Error updating play path:", error);
    throw error;
  }
}

export async function updateEpisodePlayPath(
  episodeId: string,
  playPath: string
) {
  try {
    await prisma.episode.update({
      where: {
        id: episodeId,
      },
      data: {
        playPath,
      },
    });
  } catch (error) {
    console.error("Error updating episode play path:", error);
    throw error;
  }
}

export async function getPendingTranscodeMovies() {
  try {
    const pendingMovies = await prisma.movie.findMany({
      where: {
        OR: [
          {
            transcodeStatus: TranscodeStatus.QUEUED,
          },
          {
            transcodeStatus: TranscodeStatus.IN_PROGRESS,
          },
        ],
      },
      select: {
        id: true,
        title: true,
        filePath: true,
        transcodeStatus: true,
        playPath: true,
      },
    });

    return pendingMovies;
  } catch (error) {
    console.error("Error fetching pending transcode movies:", error);
    throw error;
  }
}

/**
 * Gets all episodes where transcodeStatus is pending
 * @returns Array of episodes with pending transcodeStatus
 */
export async function getPendingTranscodeEpisodes() {
  try {
    const pendingEpisodes = await prisma.episode.findMany({
      where: {
        OR: [
          {
            transcodeStatus: TranscodeStatus.QUEUED,
          },
          {
            transcodeStatus: TranscodeStatus.IN_PROGRESS,
          },
        ],
      },
      select: {
        id: true,
        title: true,
        filePath: true,
        transcodeStatus: true,
        seasonNumber: true,
        episodeNumber: true,
        seriesId: true,
        playPath: true,
        series: {
          select: {
            title: true,
          },
        },
      },
    });

    return pendingEpisodes;
  } catch (error) {
    console.error("Error fetching pending transcode episodes:", error);
    throw error;
  }
}

export async function markAllAsPending() {
  try {
    await prisma.movie.updateMany({
      data: {
        transcodeStatus: TranscodeStatus.PENDING,
      },
    });
    await prisma.episode.updateMany({
      data: {
        transcodeStatus: TranscodeStatus.PENDING,
      },
    });
  } catch (error) {
    console.error("Error marking all as pending:", error);
    throw error;
  }
}
