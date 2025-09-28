interface CacheInvalidationResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export async function invalidateCache(): Promise<void> {
  const baseUrl = process.env.BASE_URL;
  
  if (!baseUrl) {
    console.warn("BASE_URL not found in environment variables. Skipping cache invalidation.");
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/api/progress/invalidate-cache`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as CacheInvalidationResponse;
    
    if (data.success) {
      console.log(`✅ Cache invalidated successfully at ${data.timestamp}`);
    } else {
      console.warn(`⚠️ Cache invalidation response: ${data.message}`);
    }
  } catch (error) {
    console.error("❌ Failed to invalidate cache:", error);
    // Don't throw the error to avoid stopping the transcoding process
  }
}
