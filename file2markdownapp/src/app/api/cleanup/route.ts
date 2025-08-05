import { NextResponse } from 'next/server';
import { readdir, unlink, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Clean up files older than 1 hour
const CLEANUP_AGE_MS = 60 * 60 * 1000; // 1 hour

export const runtime = 'nodejs';

export async function POST() {
  try {
    const downloadsDir = path.join(process.cwd(), 'public', 'downloads');
    const tempDir = path.join(process.cwd(), 'temp');
    
    let cleaned = 0;

    // Clean downloads directory
    if (existsSync(downloadsDir)) {
      cleaned += await cleanDirectory(downloadsDir);
    }

    // Clean temp directory
    if (existsSync(tempDir)) {
      cleaned += await cleanDirectory(tempDir);
    }

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${cleaned} old files`,
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

async function cleanDirectory(dirPath: string): Promise<number> {
  let cleaned = 0;
  
  try {
    const files = await readdir(dirPath);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await stat(filePath);
      
      // Check if file is older than cleanup age
      if (now - stats.mtime.getTime() > CLEANUP_AGE_MS) {
        try {
          await unlink(filePath);
          cleaned++;
        } catch (eUnlink) {
          // If unlink fails (e.g., directory), try rm recursively
          try {
            await rm(filePath, { recursive: true, force: true });
            cleaned++;
          } catch (eRm) {
            console.warn(`Failed to remove ${filePath}:`, eRm);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`Error cleaning directory ${dirPath}:`, error);
  }

  return cleaned;
}