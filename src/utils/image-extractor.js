const fs = require('fs');
const path = require('path');

class ImageExtractor {
  constructor(outputDir = 'images') {
    this.outputDir = outputDir;
    this.imageCounter = 0;
    this.extractedImages = new Map();
    
    // Create images directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async extractImagesFromZip(zip, basePath = '') {
    const images = [];
    
    zip.forEach((relativePath, file) => {
      // Check for image files in common locations
      if (this.isImageFile(relativePath)) {
        images.push({
          path: relativePath,
          file: file,
          basePath: basePath
        });
      }
    });

    const extractedImages = [];
    for (const img of images) {
      try {
        const imageData = await img.file.async('nodebuffer');
        const savedPath = await this.saveImage(imageData, img.path, img.basePath);
        extractedImages.push({
          originalPath: img.path,
          savedPath: savedPath,
          basePath: img.basePath
        });
      } catch (error) {
        console.warn(`Failed to extract image ${img.path}:`, error.message);
      }
    }

    return extractedImages;
  }

  async saveImage(buffer, originalPath, basePath = '') {
    this.imageCounter++;
    const ext = path.extname(originalPath) || '.png';
    const filename = `image_${this.imageCounter}${ext}`;
    const fullPath = path.join(this.outputDir, filename);
    
    try {
      fs.writeFileSync(fullPath, buffer);
      
      // Store mapping for reference lookup
      const key = basePath + originalPath;
      this.extractedImages.set(key, filename);
      
      return filename;
    } catch (error) {
      console.warn(`Failed to save image ${filename}:`, error.message);
      return null;
    }
  }

  isImageFile(filePath) {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.svg', '.emf', '.wmf'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext) || 
           filePath.includes('/media/') || 
           filePath.includes('/images/') ||
           filePath.includes('\\media\\') || 
           filePath.includes('\\images\\');
  }

  getImageReference(originalPath, basePath = '') {
    const key = basePath + originalPath;
    const savedFilename = this.extractedImages.get(key);
    if (savedFilename) {
      return `![Image](${this.outputDir}/${savedFilename})`;
    }
    return null;
  }

  getImageMarkdown(description = 'Image', imagePath) {
    if (imagePath) {
      return `![${description}](${this.outputDir}/${imagePath})`;
    }
    return `![${description}](image-not-found)`;
  }

  reset() {
    this.imageCounter = 0;
    this.extractedImages.clear();
  }
}

module.exports = ImageExtractor;