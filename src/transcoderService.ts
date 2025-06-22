import fs from "fs-extra";
import { transcodeResolutions } from "./transcoder_win_nvenc";
import { extractAudioTracks } from "./transcoder_win_nvenc";
import { copySubtitles } from "./transcoder_win_nvenc";
import { writeMasterPlaylist } from "./transcoder_win_nvenc";
import chalk from "chalk";
import path from "path";

export async function transcoder(
  input: string,
  outputDir: string,
  title: string
) {
  console.log(chalk.bgWhite.black(`-------TRANSCODING NOW: ${title}-------`));
  await fs.ensureDir(path.dirname(outputDir));
  await transcodeResolutions(input, outputDir);
  await extractAudioTracks(input, outputDir);
  await copySubtitles(input, outputDir);
  await writeMasterPlaylist(outputDir);
}
