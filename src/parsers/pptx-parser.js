const JSZip = require('jszip');
const xml2js = require('xml2js');

async function parsePptx(buffer, imageExtractor) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    // Extract images first
    const extractedImages = await imageExtractor.extractImagesFromZip(zip, 'ppt/');
    
    const slideFiles = [];
    zip.forEach((relativePath, file) => {
      if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
        slideFiles.push({
          path: relativePath,
          file: file
        });
      }
    });
    
    slideFiles.sort((a, b) => {
      const aNum = parseInt(a.path.match(/slide(\d+)\.xml/)[1]);
      const bNum = parseInt(b.path.match(/slide(\d+)\.xml/)[1]);
      return aNum - bNum;
    });
    
    let markdown = '';
    
    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const slideNumber = i + 1;
      
      markdown += `## Slide ${slideNumber}\n\n`;
      
      const xmlContent = await slideFile.file.async('string');
      const slideContent = await extractSlideContent(xmlContent, imageExtractor, extractedImages, slideNumber);
      
      if (slideContent.trim()) {
        markdown += slideContent + '\n\n';
      } else {
        markdown += '*No content*\n\n';
      }
    }
    
    return markdown.trim();
  } catch (error) {
    throw new Error(`Failed to parse PPTX: ${error.message}`);
  }
}

async function extractSlideContent(xmlContent, imageExtractor, extractedImages, slideNumber) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlContent);
    
    const content = [];
    let imageCount = 0;
    
    function extractContentFromShapes(obj, level = 0) {
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          for (const item of obj) {
            extractContentFromShapes(item, level);
          }
        } else {
          // Check for text content
          if (obj['a:t']) {
            if (Array.isArray(obj['a:t'])) {
              for (const textItem of obj['a:t']) {
                let text = '';
                if (typeof textItem === 'string') {
                  text = textItem;
                } else if (textItem && textItem._) {
                  text = textItem._;
                }
                if (text && text.trim()) {
                  // Apply basic formatting based on context
                  if (level === 0 && text.length > 50) {
                    content.push(`### ${text.trim()}`);
                  } else {
                    content.push(text.trim());
                  }
                }
              }
            }
          }
          
          // Check for images/pictures
          if (obj['a:blip'] || obj['p:pic'] || obj['a:pic']) {
            // Add image reference
            const slideImages = extractedImages.filter(img => 
              img.originalPath.includes(`slide${slideNumber}`) ||
              img.originalPath.includes('media/')
            );
            
            if (slideImages.length > imageCount) {
              const img = slideImages[imageCount];
              if (img && img.savedPath) {
                content.push(imageExtractor.getImageMarkdown(`Slide ${slideNumber} Image`, img.savedPath));
                imageCount++;
              }
            }
          }
          
          // Recursively process nested objects
          for (const key in obj) {
            if (key !== 'a:t') {
              extractContentFromShapes(obj[key], level + 1);
            }
          }
        }
      }
    }
    
    extractContentFromShapes(result);
    
    // If no content found but we have images for this slide, add them
    if (content.length === 0) {
      const slideImages = extractedImages.filter(img => 
        img.originalPath.includes(`slide${slideNumber}`) ||
        (slideNumber === 1 && img.originalPath.includes('media/'))
      );
      
      for (const img of slideImages) {
        if (img.savedPath) {
          content.push(imageExtractor.getImageMarkdown(`Slide ${slideNumber} Image`, img.savedPath));
        }
      }
    }
    
    return content
      .filter(item => item && item.trim())
      .join('\n\n')
      .trim();
  } catch (error) {
    throw new Error(`Failed to extract content from slide: ${error.message}`);
  }
}

module.exports = parsePptx;