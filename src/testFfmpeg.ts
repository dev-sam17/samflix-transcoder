import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath!);

ffmpeg("input.mp4").ffprobe((err, data) => {
  if (err) {
    console.error("Error:", err);
  } else {
    console.log("Data:", data.streams[0]);
  }
});
