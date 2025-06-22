const pathMap: Record<string, string> = {
  "/media/movies/test": "//192.168.29.41/Storage3/Movies/test-movies",
  "/media/series/test": "//192.168.29.41/Storage3/Web Series/test-series",
};

export function parseFilePath(filePath: string): string {
  // Check if the file path starts with any of the keys in pathMap
  for (const basePath in pathMap) {
    if (filePath.startsWith(basePath)) {
      // Replace the base path with the mapped path
      return filePath.replace(basePath, pathMap[basePath]);
    }
  }
  return filePath;
}
