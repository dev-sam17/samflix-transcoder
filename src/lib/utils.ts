import * as cliProgress from "cli-progress";
import chalk, { ChalkInstance } from "chalk";
// Timestamp helper function
export function getTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Enhanced logging with timestamps
export function logWithTimestamp(
  message: string,
  color: ChalkInstance = chalk.white
) {
  console.log(color(`[${getTimestamp()}] ${message}`));
}

// Progress bar helper functions using cli-progress
export function createProgressBar(title: string, total: number = 100) {
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

export function showStep(
  stepNumber: number,
  title: string,
  description?: string
) {
  console.log(
    `\n${chalk.bgBlue.white(` STEP ${stepNumber} `)} ${chalk.bold.white(title)}`
  );
  if (description) {
    logWithTimestamp(description, chalk.yellow);
  }
  console.log();
}
