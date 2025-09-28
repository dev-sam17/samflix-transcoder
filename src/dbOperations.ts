import { prisma } from "@dev-sam17/prisma-client-for-samflix";
import { TranscodeStatus } from "./lib/types";

class DbOperations {
  async updateMovieTranscodeStatus(
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

  async updateEpisodeTranscodeStatus(
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

  async updateMoviePlayPath(movieId: string, playPath: string) {
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

  async updateEpisodePlayPath(
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

  async getQueuedTranscodeMovies() {
    try {
      const queuedMovies = await prisma.movie.findMany({
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

      return queuedMovies;
    } catch (error) {
      console.error("Error fetching queued transcode movies:", error);
      throw error;
    }
  }

  /**
   * Gets all episodes where transcodeStatus is pending
   * @returns Array of episodes with pending transcodeStatus
   */
  async getQueuedTranscodeEpisodes() {
    try {
      const queuedEpisodes = await prisma.episode.findMany({
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

      return queuedEpisodes;
    } catch (error) {
      console.error("Error fetching queued transcode episodes:", error);
      throw error;
    }
  }

  async markAllAsPending() {
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
      await prisma.tvSeries.updateMany({
        data: {
          transcodeStatus: TranscodeStatus.PENDING,
        },
      });
    } catch (error) {
      console.error("Error marking all as pending:", error);
      throw error;
    }
  }

  async getQueuedTranscodeTvSeries() {
    try {
      const queuedSeries = await prisma.tvSeries.findMany({
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
        include: {
          episodes: {
            select: {
              id: true,
              title: true,
              filePath: true,
              transcodeStatus: true,
              seasonNumber: true,
              episodeNumber: true,
              playPath: true,
            },
            orderBy: [
              { seasonNumber: 'asc' },
              { episodeNumber: 'asc' }
            ]
          },
        },
      });

      return queuedSeries;
    } catch (error) {
      console.error("Error fetching queued transcode TV series:", error);
      throw error;
    }
  }

  async updateTvSeriesTranscodeStatus(
    seriesId: string,
    status: TranscodeStatus
  ) {
    try {
      await prisma.tvSeries.update({
        where: {
          id: seriesId,
        },
        data: {
          transcodeStatus: status,
        },
      });
    } catch (error) {
      console.error("Error updating TV series transcode status:", error);
      throw error;
    }
  }

  async checkAllEpisodesCompleted(seriesId: string): Promise<boolean> {
    try {
      const incompletedEpisodes = await prisma.episode.count({
        where: {
          seriesId: seriesId,
          transcodeStatus: {
            not: TranscodeStatus.COMPLETED,
          },
        },
      });

      return incompletedEpisodes === 0;
    } catch (error) {
      console.error("Error checking episodes completion status:", error);
      throw error;
    }
  }
}

export const dbOperations = new DbOperations();
