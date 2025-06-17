import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath!);

const analyzeMedia = (filePath: string) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
};

const filePath = 'input.mp4';

analyzeMedia(filePath)
  .then(metadata => {
    console.log('Media Metadata:', metadata);
  })
  .catch(error => {
    console.error('Error analyzing media:', error);
  });
