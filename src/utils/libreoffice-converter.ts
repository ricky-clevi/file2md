import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { LibreOfficeDetector } from './libreoffice-detector.js';

export interface ConversionOptions {
  quality?: 'low' | 'medium' | 'high' | 'maximum';
  timeout?: number; // milliseconds
  outputFormat?: string;
  additionalArgs?: string[];
}

export interface ConversionProgress {
  stage: 'starting' | 'converting' | 'completed' | 'error';
  percentage?: number;
  message?: string;
}

export class LibreOfficeConverter extends EventEmitter {
  private readonly detector: LibreOfficeDetector;
  
  constructor() {
    super();
    this.detector = LibreOfficeDetector.getInstance();
  }

  /**
   * Convert PPTX to PDF with enhanced options
   */
  async convertToPdf(
    inputBuffer: Buffer, 
    options: ConversionOptions = {}
  ): Promise<Buffer> {
    const {
      quality = 'maximum',
      timeout = 30000,
      additionalArgs = []
    } = options;

    // Check LibreOffice installation
    const info = await this.detector.checkLibreOfficeInstallation();
    if (!info.installed || !info.path) {
      throw new Error('LibreOffice is not installed');
    }

    // Create temporary files
    const tempId = randomBytes(8).toString('hex');
    const tempDir = path.join(tmpdir(), `libreoffice-${tempId}`);
    const inputPath = path.join(tempDir, 'input.pptx');
    const outputDir = tempDir;
    
    try {
      // Create temp directory and save input file
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(inputPath, inputBuffer);
      
      this.emit('progress', {
        stage: 'starting',
        percentage: 0,
        message: 'Initializing LibreOffice conversion...'
      });

      // Build conversion arguments
      const args = [
        '--headless',
        '--invisible',
        '--nodefault',
        '--nolockcheck',
        '--nologo',
        '--norestore',
        '--convert-to',
        this.getPdfFilter(quality),
        '--outdir',
        outputDir,
        ...additionalArgs,
        inputPath
      ];

      // Execute conversion
      const outputPath = await this.executeConversion(
        info.path,
        args,
        timeout
      );

      // Read the output PDF
      const pdfBuffer = await fs.readFile(outputPath);
      
      this.emit('progress', {
        stage: 'completed',
        percentage: 100,
        message: 'Conversion completed successfully'
      });

      return pdfBuffer;

    } finally {
      // Cleanup temporary files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get PDF filter string based on quality setting
   */
  private getPdfFilter(quality: string): string {
    switch (quality) {
      case 'maximum':
        return 'pdf:writer_pdf_Export:{"MaxImageResolution":{"type":"long","value":"300"},"UseTaggedPDF":{"type":"boolean","value":"true"},"SelectPdfVersion":{"type":"long","value":"0"},"Quality":{"type":"long","value":"100"}}';
      case 'high':
        return 'pdf:writer_pdf_Export:{"MaxImageResolution":{"type":"long","value":"200"},"Quality":{"type":"long","value":"90"}}';
      case 'medium':
        return 'pdf:writer_pdf_Export:{"MaxImageResolution":{"type":"long","value":"150"},"Quality":{"type":"long","value":"80"}}';
      case 'low':
        return 'pdf:writer_pdf_Export:{"MaxImageResolution":{"type":"long","value":"100"},"Quality":{"type":"long","value":"70"}}';
      default:
        return 'pdf:writer_pdf_Export';
    }
  }

  /**
   * Execute LibreOffice conversion with timeout and progress tracking
   */
  private executeConversion(
    sofficePath: string,
    args: string[],
    timeout: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(sofficePath, args);
      let outputPath: string | null = null;
      let stderr = '';
      let timedOut = false;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        process.kill('SIGTERM');
        reject(new Error(`Conversion timed out after ${timeout}ms`));
      }, timeout);

      // Track progress
      const progressInterval = setInterval(() => {
        if (!timedOut && outputPath === null) {
          this.emit('progress', {
            stage: 'converting',
            percentage: 50,
            message: 'Converting document...'
          });
        }
      }, 1000);

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', async (code) => {
        clearTimeout(timeoutHandle);
        clearInterval(progressInterval);

        if (timedOut) {
          return; // Already rejected
        }

        if (code !== 0) {
          reject(new Error(`LibreOffice exited with code ${code}: ${stderr}`));
          return;
        }

        // Find the output file
        try {
          const tempDir = path.dirname(args[args.length - 1]);
          const files = await fs.readdir(tempDir);
          const pdfFile = files.find(f => f.endsWith('.pdf'));
          
          if (!pdfFile) {
            reject(new Error('No PDF output file found'));
            return;
          }

          outputPath = path.join(tempDir, pdfFile);
          resolve(outputPath);
        } catch (error) {
          reject(error);
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeoutHandle);
        clearInterval(progressInterval);
        reject(error);
      });
    });
  }

  /**
   * Convert with progress callback
   */
  async convertWithProgress(
    inputBuffer: Buffer,
    options: ConversionOptions = {},
    onProgress?: (progress: ConversionProgress) => void
  ): Promise<Buffer> {
    if (onProgress) {
      this.on('progress', onProgress);
    }

    try {
      return await this.convertToPdf(inputBuffer, options);
    } finally {
      if (onProgress) {
        this.removeListener('progress', onProgress);
      }
    }
  }
}