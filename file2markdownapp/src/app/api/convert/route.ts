import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink, rm } from 'fs/promises';
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
    // Optional advanced options from client
    const preserveLayoutFlag = (formData.get('preserveLayout') as string | null)?.toLowerCase?.() === 'true';
    const extractImagesFlag = (formData.get('extractImages') as string | null)?.toLowerCase?.() !== 'false';
    const extractChartsFlag = (formData.get('extractCharts') as string | null)?.toLowerCase?.() !== 'false';

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
    
    
    try {
      if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
      }
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
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
      
      const result = await convert(tempFilePath, {
        imageDir: imageDir,    // For legacy mode (DOCX, etc.)
        outputDir: imageDir,   // For slide screenshots (PPTX)
        preserveLayout: preserveLayoutFlag || true,
        extractImages: extractImagesFlag,
        extractCharts: extractChartsFlag,
      });
    

      const hasImages = result.images.length > 0;
      let downloadUrl: string;
      let filename: string;
      let previewMarkdown = result.markdown;

      if (hasImages) {
        // Create ZIP file with markdown and images, ensure unique filename
        filename = `${originalName}__${fileId}.zip`;
        const zipPath = path.join(outputDir, filename);
        
        // Create a public images mirror for preview: /downloads/<fileId>-images/images/*
        // IMPORTANT: Do this BEFORE ZIP creation to avoid race condition with cleanup
        try {
          const publicImagesDir = path.join(outputDir, `${fileId}-images`, 'images');
          await mkdir(publicImagesDir, { recursive: true });

          
          for (const image of result.images) {
            const savedPath = typeof image.savedPath === 'string' ? image.savedPath : '';
            if (!savedPath) continue;
            
            try {
              // Check if source file exists before copying
              const fs = await import('fs/promises');
              await fs.access(savedPath);
              
              const imageName = path.basename(savedPath);
              const dest = path.join(publicImagesDir, imageName);
              
              // Copy file for preview
              const fileBuffer = await fs.readFile(savedPath);
              await writeFile(dest, fileBuffer);
            } catch (copyError) {
              // Continue with other images instead of failing completely
            }
          }
          
        } catch (mirrorErr) {
          console.warn('Failed to build public preview images mirror:', mirrorErr);
        }

        await createZipFile(zipPath, result.markdown, originalName, [...result.images], tempFilePath, imageDir);
        downloadUrl = `/downloads/${filename}`;
        
        // Rewrite markdown image links for preview to point to public mirror
        const baseUrl = `/downloads/${fileId}-images/images/`;
                
        // Enhanced replacement to handle various image reference formats
        // Also handle HTML img tags for better compatibility
        previewMarkdown = result.markdown
          .replace(/\]\(images\//g, `](${baseUrl}`)
          .replace(/\]\(\.\/images\//g, `](${baseUrl}`)
          .replace(/src="images\//g, `src="${baseUrl}`)
          .replace(/src="\.\/images\//g, `src="${baseUrl}`)
          .replace(/src='images\//g, `src='${baseUrl}`)
          .replace(/src='\.\/images\//g, `src='${baseUrl}`);
        
        // Additional fix: Ensure all image references use absolute URLs
        previewMarkdown = previewMarkdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
          if (src.startsWith('images/') || src.startsWith('./images/')) {
            const cleanSrc = src.replace(/^\.\/images\//, 'images/').replace(/^images\//, '');
            const fullUrl = `${baseUrl}${cleanSrc}`;
            return `![${alt}](${fullUrl})`;
          }
          return match;
        });
        
        
      } else {
        // Save markdown file directly, ensure unique filename
        filename = `${originalName}__${fileId}.md`;
        const mdPath = path.join(outputDir, filename);
        await writeFile(mdPath, result.markdown, 'utf-8');
        downloadUrl = `/downloads/${filename}`;
        
        // Clean up temporary files for non-image case
        await cleanupTempFiles(tempFilePath, imageDir);
      }

      // Build extra stats for UI
      const inputBytes = buffer.length;
      const markdownBytes = Buffer.byteLength(result.markdown || '', 'utf-8');
      const stats: {
        inputBytes: number;
        markdownBytes: number;
        compressionRatio: number | null;
        imageCount: number;
        chartCount: number;
        processingTimeMs?: number;
      } = {
        inputBytes,
        markdownBytes,
        compressionRatio: inputBytes > 0 ? Number((markdownBytes / inputBytes).toFixed(2)) : null,
        imageCount: result.images?.length || 0,
        chartCount: result.charts?.length || 0,
        processingTimeMs: ((): number | undefined => {
          const md = result.metadata as unknown;
          if (md && typeof md === 'object' && 'processingTime' in md) {
            const val = (md as { processingTime?: unknown }).processingTime;
            return typeof val === 'number' ? val : undefined;
          }
          return undefined;
        })(),
      };

      return NextResponse.json({
        success: true,
        filename,
        hasImages,
        downloadUrl,
        markdown: previewMarkdown,
        imageCount: result.images?.length || 0,
        chartCount: result.charts?.length || 0,
        metadata: result.metadata,
        stats,
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
  images: { savedPath: string }[],
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
      await rm(imageDir, { recursive: true, force: true });
    }
    
  } catch (error) {
    console.warn('Cleanup error:', error);
    // Don't throw - cleanup errors shouldn't break the main flow
  }
}