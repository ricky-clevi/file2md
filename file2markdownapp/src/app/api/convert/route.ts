import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

// Import from published package
import { convert } from 'file2md';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type and size (server-side)
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/x-hwp',
      'application/x-hwpx',
      'application/x-cfb', // CFB files might be HWP files
      'application/zip', // ZIP files might be HWPX files
    ];
    const allowedExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.hwp', '.hwpx'];

    // 50MB limit
    const MAX_SIZE = 50 * 1024 * 1024;
    if (typeof file.size === 'number' && file.size > MAX_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large. Max 50MB.' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    }

    // Primary by MIME, fallback to extension (case-insensitive)
    let isAllowed = !!file.type && allowedTypes.includes(file.type);
    if (!isAllowed) {
      const nameLower = file.name?.toLowerCase?.() ?? '';
      const ext = nameLower.slice(nameLower.lastIndexOf('.'));
      if (allowedExts.includes(ext)) {
        isAllowed = true;
      }
    }
    if (!isAllowed) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type' },
        { status: 400 }
      );
    }

    // Create temporary directories
    const tempDir = path.join(process.cwd(), 'temp');
    const outputDir = path.join(process.cwd(), 'public', 'downloads');
    
    console.log('Creating directories:', { tempDir, outputDir });
    
    try {
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
        console.log('Created temp directory:', tempDir);
      }
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
        console.log('Created output directory:', outputDir);
      }
    } catch (error) {
      console.error('Failed to create directories:', error);
      throw error;
    }

    // Generate unique file ID
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
    // Sanitize filename by removing special characters
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const originalName = sanitizedFileName.replace(/\.[^/.]+$/, ''); // Remove extension
    
    // Save uploaded file temporarily
    const tempFilePath = path.join(tempDir, `${fileId}-${sanitizedFileName}`);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(tempFilePath, buffer);

    try {
      // Use the imported convert function
      
      // Convert file using file2md with enhanced options
      const imageDir = path.join(tempDir, `${fileId}-images`);
      console.log('Image directory configured:', imageDir);
      
      const result = await convert(tempFilePath, {
        imageDir: imageDir,    // For legacy mode (DOCX, etc.)
        outputDir: imageDir,   // For slide screenshots (PPTX)
        preserveLayout: true,
        extractImages: true,
        extractCharts: true,
      });
      
      console.log('Conversion result - images found:', result.images.length);
      if (result.images.length > 0) {
        console.log('First few image paths:');
        result.images.slice(0, 3).forEach((img, i) => {
          console.log(`  ${i + 1}: ${img.savedPath}`);
        });
        if (result.images.length > 3) {
          console.log(`  ... and ${result.images.length - 3} more images`);
        }
      }

      const hasImages = result.images.length > 0;
      let downloadUrl: string;
      let filename: string;

      if (hasImages) {
        // Create ZIP file with markdown and images, ensure unique filename
        filename = `${originalName}__${fileId}.zip`;
        const zipPath = path.join(outputDir, filename);
        
        await createZipFile(zipPath, result.markdown, originalName, [...result.images], tempFilePath, imageDir);
        downloadUrl = `/downloads/${filename}`;
      } else {
        // Save markdown file directly, ensure unique filename
        filename = `${originalName}__${fileId}.md`;
        const mdPath = path.join(outputDir, filename);
        await writeFile(mdPath, result.markdown, 'utf-8');
        downloadUrl = `/downloads/${filename}`;
        
        // Clean up temporary files for non-image case
        await cleanupTempFiles(tempFilePath, imageDir);
      }

      return NextResponse.json({
        success: true,
        filename,
        hasImages,
        downloadUrl,
      });

    } catch (conversionError) {
      console.error('Conversion error:', conversionError);
      
      // Clean up temporary files on error
      let imageDir: string | undefined;
      try {
        imageDir = path.join(tempDir, `${fileId}-images`);
        await cleanupTempFiles(tempFilePath, imageDir);
      } catch (cleanupError) {
        console.warn('Cleanup error:', cleanupError);
      }
      
      const message = conversionError instanceof Error ? conversionError.message : 'Unknown error';
      return new Response(JSON.stringify({ error: `Conversion failed: ${message}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Server error: ${message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function createZipFile(
  zipPath: string, 
  markdown: string, 
  originalName: string, 
  images: any[],
  tempFilePath: string,
  imageDir: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      // Clean up temporary files AFTER ZIP is complete
      cleanupTempFiles(tempFilePath, imageDir)
        .catch(err => console.warn('Cleanup error:', err));
      resolve();
    });
    
    archive.on('error', (err) => {
      // Clean up on error too, but don't throw from cleanup
      cleanupTempFiles(tempFilePath, imageDir)
        .catch(cleanupErr => console.warn('Cleanup error:', cleanupErr));
      reject(err);
    });

    archive.pipe(output);

    // Add markdown file
    archive.append(markdown, { name: `${originalName}.md` });

    // Add image files with path normalization and containment check
    console.log(`ZIP creation: Processing ${images.length} images`);
    
    for (const image of images) {
      try {
        const savedPath = typeof image.savedPath === 'string' ? image.savedPath : '';
        const absImagePath = path.resolve(savedPath);
        const absImageDir = path.resolve(imageDir);

        // ensure image path is within imageDir
        if (!absImagePath.startsWith(absImageDir + path.sep) && absImagePath !== absImageDir) {
          console.warn(`Skipping image outside expected directory: ${path.basename(absImagePath)}`);
          continue;
        }

        const imageName = path.basename(absImagePath);
        if (existsSync(absImagePath)) {
          console.log(`Adding image to ZIP: ${imageName}`);
          archive.file(absImagePath, { name: `images/${imageName}` });
        } else {
          console.warn(`Image file not found: ${imageName}`);
        }
      } catch (e) {
        console.warn(`Error processing image for ZIP:`, e);
      }
    }

    archive.finalize();
  });
}

async function cleanupTempFiles(tempFilePath: string, imageDir: string): Promise<void> {
  try {
    // Remove temp file
    if (existsSync(tempFilePath)) {
      await unlink(tempFilePath);
    }

    // Remove image directory and its contents using robust rm
    if (existsSync(imageDir)) {
      const { rm } = await import('fs/promises');
      await rm(imageDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('Cleanup error:', error);
    // Don't throw - cleanup errors shouldn't break the main flow
  }
}