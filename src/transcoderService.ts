import fs from "fs-extra";
import { transcodeResolutions } from "./transcoder_win_nvenc";
import { extractAudioTracks } from "./transcoder_win_nvenc";
import { copySubtitles } from "./transcoder_win_nvenc";
import { writeMasterPlaylist } from "./transcoder_win_nvenc";

const input = "chanduChampion.mkv";
const outputDir = "output";

async function runAll() {
  await fs.ensureDir(outputDir);
  await transcodeResolutions(input, outputDir);
  await extractAudioTracks(input, outputDir);
  await copySubtitles(input, outputDir);
  await writeMasterPlaylist(outputDir);
}

runAll();
