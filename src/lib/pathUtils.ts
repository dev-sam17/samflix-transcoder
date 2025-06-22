import fs from "fs-extra";
import path from "path";

/**
 * Check if a file exists and is accessible
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a path with forward slashes to Windows backslashes
 */
export function toWindowsPath(filePath: string): string {
  // If the path is already a Windows path, return it as is
  if (/^[a-zA-Z]:\\/.test(filePath)) {
    return filePath;
  }

  // If it's a UNC path (\\server\share\...), return it as is
  if (filePath.startsWith("\\\\")) {
    return filePath;
  }

  // If it's a path like //server/share/..., convert to Windows UNC format
  if (filePath.startsWith("//")) {
    return filePath.replace(/\//g, "\\");
  }

  // Return the original path if none of the above conditions match
  return filePath;
}

/**
 * Converts a Windows path with backslashes to Unix path with forward slashes
 */
export function toUnixPath(filePath: string): string {
  // If the path is already using forward slashes, return it as is
  if (!filePath.includes("\\")) {
    return filePath;
  }

  // Replace all backslashes with forward slashes
  let unixPath = filePath.replace(/\\/g, "/");

  // Handle Windows drive letter (e.g., C:/ becomes /c/)
  if (/^[a-zA-Z]:\//.test(unixPath)) {
    const driveLetter = unixPath.charAt(0).toLowerCase();
    unixPath = `/${driveLetter}${unixPath.substring(2)}`;
  }

  // Handle UNC paths (\\server\share becomes //server/share)
  if (unixPath.startsWith("//")) {
    // Already in the correct format after replacing backslashes
  }

  return unixPath;
}

/**
 * Sanitizes a path component by removing or replacing invalid characters for Windows file paths
 */
export function sanitizePathComponent(pathComponent: string): string {
  // Replace invalid characters with safe alternatives
  return pathComponent
    .replace(/[<>:"|?*]/g, "") // Remove completely invalid characters
    .replace(/[[\]]/g, "") // Remove square brackets
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim(); // Remove leading/trailing whitespace
}

/**
 * Sanitizes a full path by sanitizing each component separately
 */
export function sanitizePath(fullPath: string): string {
  const isUNC = fullPath.startsWith("\\\\") || fullPath.startsWith("//");
  const pathSeparator = fullPath.includes("\\") ? "\\" : "/";

  if (isUNC) {
    // Handle UNC paths specially - preserve the server and share names
    const uncPrefix = fullPath.startsWith("\\\\") ? "\\\\" : "//";
    const pathWithoutPrefix = fullPath.substring(2);
    const pathParts = pathWithoutPrefix.split(/[\\/]/);

    if (pathParts.length >= 2) {
      // Keep server and share names as-is, sanitize the rest
      const server = pathParts[0];
      const share = pathParts[1];
      const remainingParts = pathParts.slice(2).map(sanitizePathComponent);
      return (
        uncPrefix +
        server +
        pathSeparator +
        share +
        pathSeparator +
        remainingParts.join(pathSeparator)
      );
    }
  }

  // Handle regular paths
  const parts = fullPath.split(/[\\/]/);

  // Keep drive letter as-is for Windows paths
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    const driveLetter = parts[0];
    const sanitizedParts = parts.slice(1).map(sanitizePathComponent);
    return driveLetter + pathSeparator + sanitizedParts.join(pathSeparator);
  }

  // Sanitize all parts for other paths
  return parts.map(sanitizePathComponent).join(pathSeparator);
}

/**
 * Reads a file from a network path
 */
export async function readNetworkFile(filePath: string): Promise<Buffer> {
  const windowsPath = toWindowsPath(filePath);

  try {
    return await fs.readFile(windowsPath);
  } catch (error) {
    console.error("Error reading file:", error);
    throw new Error(`Failed to read file at ${filePath}`);
  }
}

/**
 * Lists files in a network directory
 */
export async function listNetworkDirectory(dirPath: string): Promise<string[]> {
  const windowsPath = toWindowsPath(dirPath);

  try {
    return await fs.readdir(windowsPath);
  } catch (error) {
    console.error("Error listing directory:", error);
    throw new Error(`Failed to list directory at ${dirPath}`);
  }
}

// Test function
async function main() {
  const filePath = "//192.168.29.41/Storage3/test.txt";

  console.log("Original path:", filePath);
  const windowsPath = toWindowsPath(filePath);
  console.log("Windows path:", windowsPath);

  const exists = await fileExists(windowsPath);
  console.log("File exists:", exists);

  if (exists) {
    const fileContent = await readNetworkFile(filePath);
    console.log("File content:", fileContent);
  }

  if (!exists) {
    // Try to list the parent directory
    const parentDir = path.dirname(windowsPath);
    console.log("Trying to access parent directory:", parentDir);

    const parentExists = await fileExists(parentDir);
    console.log("Parent directory exists:", parentExists);

    if (parentExists) {
      try {
        const files = await listNetworkDirectory(parentDir);
        console.log(`Found ${files.length} files in parent directory`);
        if (files.length > 0) {
          console.log("First few files:", files.slice(0, 3));
        }
      } catch (error) {
        console.log("Error listing parent directory:", error);
      }
    }
  }
}

// Run the main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
