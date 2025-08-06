import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface LibreOfficeInfo {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export class LibreOfficeDetector {
  private static instance: LibreOfficeDetector;
  private cachedInfo?: LibreOfficeInfo;

  private constructor() {}

  static getInstance(): LibreOfficeDetector {
    if (!LibreOfficeDetector.instance) {
      LibreOfficeDetector.instance = new LibreOfficeDetector();
    }
    return LibreOfficeDetector.instance;
  }

  /**
   * Check if LibreOffice is installed and get its information
   */
  async checkLibreOfficeInstallation(): Promise<LibreOfficeInfo> {
    // Return cached result if available
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    try {
      const info = await this.detectLibreOffice();
      this.cachedInfo = info;
      return info;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        installed: false,
        error: errorMessage
      };
    }
  }

  /**
   * Detect LibreOffice based on platform
   */
  private async detectLibreOffice(): Promise<LibreOfficeInfo> {
    const platformName = platform();
    
    switch (platformName) {
      case 'win32':
        return await this.detectWindows();
      case 'darwin':
        return await this.detectMacOS();
      case 'linux':
        return await this.detectLinux();
      default:
        return {
          installed: false,
          error: `Unsupported platform: ${platformName}`
        };
    }
  }

  /**
   * Detect LibreOffice on Windows
   */
  private async detectWindows(): Promise<LibreOfficeInfo> {
    const possiblePaths = [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      process.env['PROGRAMFILES'] + '\\LibreOffice\\program\\soffice.exe',
      process.env['PROGRAMFILES(X86)'] + '\\LibreOffice\\program\\soffice.exe'
    ];

    // Try common installation paths
    for (const checkPath of possiblePaths) {
      if (checkPath && await this.fileExists(checkPath)) {
        const version = await this.getVersion(checkPath);
        return {
          installed: true,
          path: checkPath,
          version
        };
      }
    }

    // Try to find via registry or command
    try {
      const { stdout } = await execAsync('where soffice.exe');
      const path = stdout.trim().split('\n')[0];
      if (path && await this.fileExists(path)) {
        const version = await this.getVersion(path);
        return {
          installed: true,
          path,
          version
        };
      }
    } catch {
      // Command failed, LibreOffice not in PATH
    }

    return {
      installed: false,
      error: 'LibreOffice not found in common Windows locations'
    };
  }

  /**
   * Detect LibreOffice on macOS
   */
  private async detectMacOS(): Promise<LibreOfficeInfo> {
    const possiblePaths = [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/usr/local/bin/soffice',
      '/opt/homebrew/bin/soffice'
    ];

    // Try common installation paths
    for (const checkPath of possiblePaths) {
      if (await this.fileExists(checkPath)) {
        const version = await this.getVersion(checkPath);
        return {
          installed: true,
          path: checkPath,
          version
        };
      }
    }

    // Try to find via which command
    try {
      const { stdout } = await execAsync('which soffice');
      const path = stdout.trim();
      if (path && await this.fileExists(path)) {
        const version = await this.getVersion(path);
        return {
          installed: true,
          path,
          version
        };
      }
    } catch {
      // Command failed
    }

    return {
      installed: false,
      error: 'LibreOffice not found in common macOS locations'
    };
  }

  /**
   * Detect LibreOffice on Linux
   */
  private async detectLinux(): Promise<LibreOfficeInfo> {
    const possiblePaths = [
      '/usr/bin/soffice',
      '/usr/local/bin/soffice',
      '/opt/libreoffice/program/soffice',
      '/snap/bin/libreoffice'
    ];

    // Try common installation paths
    for (const checkPath of possiblePaths) {
      if (await this.fileExists(checkPath)) {
        const version = await this.getVersion(checkPath);
        return {
          installed: true,
          path: checkPath,
          version
        };
      }
    }

    // Try to find via which command
    try {
      const { stdout } = await execAsync('which soffice');
      const path = stdout.trim();
      if (path && await this.fileExists(path)) {
        const version = await this.getVersion(path);
        return {
          installed: true,
          path,
          version
        };
      }
    } catch {
      // Command failed
    }

    return {
      installed: false,
      error: 'LibreOffice not found in common Linux locations'
    };
  }

  /**
   * Get LibreOffice version
   */
  private async getVersion(execPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`"${execPath}" --version`);
      const versionMatch = stdout.match(/LibreOffice ([\d.]+)/);
      return versionMatch ? versionMatch[1] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if LibreOffice version meets minimum requirement
   */
  isVersionSupported(version?: string): boolean {
    if (!version) return false;
    
    const parts = version.split('.');
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1] || '0', 10);
    
    // Require LibreOffice 7.0 or higher
    return major > 7 || (major === 7 && minor >= 0);
  }

  /**
   * Get installation instructions for current platform
   */
  getInstallationInstructions(): string {
    const platformName = platform();
    
    switch (platformName) {
      case 'win32':
        return `
LibreOffice Installation Instructions for Windows:

1. Download LibreOffice from: https://www.libreoffice.org/download/download/
2. Run the installer and follow the installation wizard
3. Default installation path: C:\\Program Files\\LibreOffice

Alternative: Use Chocolatey package manager:
   choco install libreoffice-fresh
`;

      case 'darwin':
        return `
LibreOffice Installation Instructions for macOS:

1. Download LibreOffice from: https://www.libreoffice.org/download/download/
2. Open the .dmg file and drag LibreOffice to Applications
3. Default installation path: /Applications/LibreOffice.app

Alternative: Use Homebrew:
   brew install --cask libreoffice
`;

      case 'linux':
        return `
LibreOffice Installation Instructions for Linux:

Ubuntu/Debian:
   sudo apt update
   sudo apt install libreoffice

Fedora:
   sudo dnf install libreoffice

Arch Linux:
   sudo pacman -S libreoffice-fresh

Alternative: Download from https://www.libreoffice.org/download/download/
`;

      default:
        return `
Please visit https://www.libreoffice.org/download/download/ to download LibreOffice for your platform.
`;
    }
  }

  /**
   * Get download URL for current platform
   */
  getDownloadUrl(): string {
    const platformName = platform();
    const arch = process.arch;
    
    const baseUrl = 'https://www.libreoffice.org/donate/dl/';
    
    switch (platformName) {
      case 'win32':
        return arch === 'x64' 
          ? `${baseUrl}win-x86_64/7.6.4/en-US/LibreOffice_7.6.4_Win_x86-64.msi`
          : `${baseUrl}win-x86/7.6.4/en-US/LibreOffice_7.6.4_Win_x86.msi`;
      
      case 'darwin':
        return `${baseUrl}mac-x86_64/7.6.4/en-US/LibreOffice_7.6.4_MacOS_x86-64.dmg`;
      
      case 'linux':
        return `${baseUrl}deb-x86_64/7.6.4/en-US/LibreOffice_7.6.4_Linux_x86-64_deb.tar.gz`;
      
      default:
        return 'https://www.libreoffice.org/download/download/';
    }
  }

  /**
   * Clear cached LibreOffice info
   */
  clearCache(): void {
    this.cachedInfo = undefined;
  }
}