import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { ParseError } from '../types/errors.js';

// Visual element types
export interface SlideLayout {
  slideId: string;
  slideNumber: number;
  title?: string;
  background?: BackgroundInfo;
  elements: VisualElement[];
  dimensions: SlideDimensions;
}

export interface SlideDimensions {
  width: number;
  height: number;
  units: 'EMU' | 'points' | 'pixels';
}

export interface BackgroundInfo {
  type: 'solid' | 'gradient' | 'image' | 'pattern';
  color?: string;
  colors?: string[]; // For gradients
  imagePath?: string;
}

export interface VisualElement {
  id: string;
  type: 'text' | 'shape' | 'image' | 'chart' | 'table' | 'group';
  position: ElementPosition;
  size: ElementSize;
  content?: any;
  style?: ElementStyle;
  children?: VisualElement[]; // For groups
}

export interface ElementPosition {
  x: number;
  y: number;
  z: number; // Z-index for layering
}

export interface ElementSize {
  width: number;
  height: number;
}

export interface ElementStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  rotation?: number;
  font?: FontInfo;
}

export interface FontInfo {
  family: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface TextElement extends VisualElement {
  type: 'text';
  content: {
    text: string;
    paragraphs: TextParagraph[];
  };
}

export interface TextParagraph {
  text: string;
  runs: TextRun[];
  alignment: 'left' | 'center' | 'right' | 'justify';
  level: number;
}

export interface TextRun {
  text: string;
  font?: FontInfo;
}

export interface ShapeElement extends VisualElement {
  type: 'shape';
  content: {
    shapeType: string;
    geometry?: any;
  };
}

export interface ImageElement extends VisualElement {
  type: 'image';
  content: {
    imagePath: string;
    originalSize: ElementSize;
    aspectRatio: number;
  };
}

export interface ChartElement extends VisualElement {
  type: 'chart';
  content: {
    chartType: string;
    data?: any;
    series?: any[];
  };
}

export interface TableElement extends VisualElement {
  type: 'table';
  content: {
    rows: TableRow[];
    columnWidths: number[];
    style?: TableStyle;
  };
}

export interface TableRow {
  cells: TableCell[];
  height?: number;
}

export interface TableCell {
  text: string;
  colspan?: number;
  rowspan?: number;
  style?: ElementStyle;
}

export interface TableStyle {
  borderStyle?: string;
  borderColor?: string;
  borderWidth?: number;
  headerStyle?: ElementStyle;
}

export class PptxVisualParser {
  private zip: JSZip | null = null;
  private slideCount = 0;
  private relationships: Map<string, any> = new Map();
  private themes: Map<string, any> = new Map();

  /**
   * Parse PPTX buffer to extract comprehensive visual information
   */
  async parseVisualElements(pptxBuffer: Buffer): Promise<SlideLayout[]> {
    try {
      // Load PPTX as ZIP
      this.zip = await JSZip.loadAsync(pptxBuffer);
      
      // Parse presentation structure
      const presentationXml = await this.getXmlContent('ppt/presentation.xml');
      const presentation = await parseStringPromise(presentationXml);
      
      // Extract slide references
      const slideIds = this.extractSlideReferences(presentation);
      this.slideCount = slideIds.length;
      
      console.log(`Found ${this.slideCount} slides to parse`);

      // Load relationships and themes
      await this.loadRelationships();
      await this.loadThemes();

      // Parse each slide
      const slides: SlideLayout[] = [];
      
      for (let i = 0; i < slideIds.length; i++) {
        const slideId = slideIds[i];
        try {
          const slide = await this.parseSlide(slideId.id, slideId.rId, i + 1);
          slides.push(slide);
          console.log(`Parsed slide ${i + 1}: ${slide.elements.length} elements`);
        } catch (slideError) {
          console.warn(`Failed to parse slide ${i + 1}:`, slideError);
          // Create a placeholder slide
          slides.push(this.createPlaceholderSlide(slideId.id, i + 1));
        }
      }

      return slides;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new ParseError('PptxVisualParser', `Visual parsing failed: ${message}`, error as Error);
    }
  }

  /**
   * Extract slide references from presentation.xml
   */
  private extractSlideReferences(presentation: any): Array<{id: string, rId: string}> {
    const slideIds: Array<{id: string, rId: string}> = [];
    
    try {
      const slideIdList = presentation?.['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId'];
      
      if (slideIdList && Array.isArray(slideIdList)) {
        for (const slide of slideIdList) {
          const id = slide.$?.id;
          const rId = slide.$?.['r:id'];
          if (id && rId) {
            slideIds.push({ id, rId });
          }
        }
      }
    } catch (error) {
      console.warn('Error extracting slide references:', error);
    }

    return slideIds;
  }

  /**
   * Load relationships from _rels files
   */
  private async loadRelationships(): Promise<void> {
    try {
      // Load presentation relationships
      const presRels = await this.getXmlContent('ppt/_rels/presentation.xml.rels');
      if (presRels) {
        const relsDoc = await parseStringPromise(presRels);
        this.relationships.set('presentation', relsDoc);
      }

      // Load slide relationships
      this.zip?.forEach((relativePath, file) => {
        if (relativePath.includes('ppt/slides/_rels/') && relativePath.endsWith('.rels')) {
          // Load slide-specific relationships
          file.async('string').then(async (content) => {
            try {
              const relsDoc = await parseStringPromise(content);
              const slideId = relativePath.match(/slide(\d+)\.xml\.rels/)?.[1];
              if (slideId) {
                this.relationships.set(`slide${slideId}`, relsDoc);
              }
            } catch (error) {
              console.warn(`Failed to parse relationships for ${relativePath}:`, error);
            }
          });
        }
      });
    } catch (error) {
      console.warn('Error loading relationships:', error);
    }
  }

  /**
   * Load theme information
   */
  private async loadThemes(): Promise<void> {
    try {
      this.zip?.forEach((relativePath, file) => {
        if (relativePath.includes('ppt/theme/') && relativePath.endsWith('.xml')) {
          file.async('string').then(async (content) => {
            try {
              const themeDoc = await parseStringPromise(content);
              const themeId = relativePath.match(/theme(\d+)\.xml/)?.[1] || '1';
              this.themes.set(themeId, themeDoc);
            } catch (error) {
              console.warn(`Failed to parse theme ${relativePath}:`, error);
            }
          });
        }
      });
    } catch (error) {
      console.warn('Error loading themes:', error);
    }
  }

  /**
   * Parse individual slide
   */
  private async parseSlide(slideId: string, rId: string, slideNumber: number): Promise<SlideLayout> {
    // Get slide path from relationships
    const slideRel = this.findRelationshipTarget('presentation', rId);
    const slidePath = slideRel ? `ppt/${slideRel.target}` : `ppt/slides/slide${slideNumber}.xml`;
    
    // Load slide XML
    const slideXml = await this.getXmlContent(slidePath);
    const slideDoc = await parseStringPromise(slideXml);
    
    // Extract slide dimensions
    const dimensions = this.extractSlideDimensions(slideDoc);
    
    // Extract background
    const background = this.extractSlideBackground(slideDoc);
    
    // Extract title
    const title = this.extractSlideTitle(slideDoc);
    
    // Parse visual elements
    const elements = await this.parseSlideElements(slideDoc, slideNumber);
    
    return {
      slideId,
      slideNumber,
      title,
      background,
      elements,
      dimensions
    };
  }

  /**
   * Extract slide dimensions
   */
  private extractSlideDimensions(slideDoc: any): SlideDimensions {
    try {
      // Default PowerPoint slide dimensions in EMUs (English Metric Units)
      // Standard 16:9 slide: 12192000 x 6858000 EMUs
      const defaultWidth = 12192000;
      const defaultHeight = 6858000;
      
      // Try to extract actual dimensions from slide master or layout
      // This is a simplified implementation
      return {
        width: defaultWidth,
        height: defaultHeight,
        units: 'EMU'
      };
    } catch {
      // Fallback to standard dimensions
      return {
        width: 12192000,
        height: 6858000,
        units: 'EMU'
      };
    }
  }

  /**
   * Extract slide background information
   */
  private extractSlideBackground(slideDoc: any): BackgroundInfo | undefined {
    try {
      const bg = slideDoc?.['p:sld']?.['p:cSld']?.[0]?.['p:bg'];
      if (bg) {
        // This is a simplified implementation
        // Real implementation would parse various background types
        return {
          type: 'solid',
          color: '#FFFFFF'
        };
      }
    } catch {
      // No background or parsing failed
    }
    return undefined;
  }

  /**
   * Extract slide title
   */
  private extractSlideTitle(slideDoc: any): string | undefined {
    try {
      const shapes = slideDoc?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'];
      
      if (shapes && Array.isArray(shapes)) {
        for (const shape of shapes) {
          const nvSpPr = shape?.['p:nvSpPr']?.[0];
          const ph = nvSpPr?.['p:nvPr']?.[0]?.['p:ph']?.[0];
          
          if (ph?.$ && ph.$.type === 'title') {
            // Extract text from title shape
            const textBody = shape?.['p:txBody']?.[0];
            if (textBody) {
              const text = this.extractTextFromBody(textBody);
              return text;
            }
          }
        }
      }
    } catch {
      // Title extraction failed
    }
    return undefined;
  }

  /**
   * Parse all visual elements in a slide
   */
  private async parseSlideElements(slideDoc: any, slideNumber: number): Promise<VisualElement[]> {
    const elements: VisualElement[] = [];
    
    try {
      const spTree = slideDoc?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0];
      
      if (!spTree) {
        return elements;
      }

      // Parse shapes
      const shapes = spTree['p:sp'];
      if (shapes && Array.isArray(shapes)) {
        for (const shape of shapes) {
          const element = await this.parseShape(shape, slideNumber);
          if (element) {
            elements.push(element);
          }
        }
      }

      // Parse groups
      const groups = spTree['p:grpSp'];
      if (groups && Array.isArray(groups)) {
        for (const group of groups) {
          const element = await this.parseGroup(group, slideNumber);
          if (element) {
            elements.push(element);
          }
        }
      }

      // Parse pictures
      const pics = spTree['p:pic'];
      if (pics && Array.isArray(pics)) {
        for (const pic of pics) {
          const element = await this.parsePicture(pic, slideNumber);
          if (element) {
            elements.push(element);
          }
        }
      }

      // Parse charts
      const charts = spTree['p:graphicFrame'];
      if (charts && Array.isArray(charts)) {
        for (const chart of charts) {
          const element = await this.parseChart(chart, slideNumber);
          if (element) {
            elements.push(element);
          }
        }
      }

    } catch (error) {
      console.warn(`Error parsing slide ${slideNumber} elements:`, error);
    }

    return elements;
  }

  /**
   * Parse a shape element
   */
  private async parseShape(shape: any, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = shape?.['p:nvSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = shape?.['p:nvSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'shape';
      
      // Extract position and size
      const spPr = shape?.['p:spPr']?.[0];
      const xfrm = spPr?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Check if it has text content
      const textBody = shape?.['p:txBody']?.[0];
      
      if (textBody) {
        // Text element
        const text = this.extractTextFromBody(textBody);
        const paragraphs = this.extractParagraphsFromBody(textBody);
        
        return {
          id: `${id}_${name}`,
          type: 'text',
          position,
          size,
          content: {
            text,
            paragraphs
          },
          style: this.extractElementStyle(spPr, textBody)
        };
      } else {
        // Shape element
        return {
          id: `${id}_${name}`,
          type: 'shape',
          position,
          size,
          content: {
            shapeType: this.extractShapeType(spPr),
            geometry: this.extractShapeGeometry(spPr)
          },
          style: this.extractElementStyle(spPr)
        };
      }
    } catch (error) {
      console.warn('Error parsing shape:', error);
      return null;
    }
  }

  /**
   * Parse a group element
   */
  private async parseGroup(group: any, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = group?.['p:nvGrpSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = group?.['p:nvGrpSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'group';
      
      // Extract position and size
      const grpSpPr = group?.['p:grpSpPr']?.[0];
      const xfrm = grpSpPr?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Parse child elements
      const children: VisualElement[] = [];
      
      // Child shapes
      const shapes = group['p:sp'];
      if (shapes && Array.isArray(shapes)) {
        for (const shape of shapes) {
          const child = await this.parseShape(shape, slideNumber);
          if (child) children.push(child);
        }
      }
      
      return {
        id: `${id}_${name}`,
        type: 'group',
        position,
        size,
        content: {},
        children
      };
    } catch (error) {
      console.warn('Error parsing group:', error);
      return null;
    }
  }

  /**
   * Parse a picture element
   */
  private async parsePicture(pic: any, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = pic?.['p:nvPicPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = pic?.['p:nvPicPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'image';
      
      // Extract position and size
      const spPr = pic?.['p:spPr']?.[0];
      const xfrm = spPr?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Extract image reference
      const blip = pic?.['p:blipFill']?.[0]?.['a:blip']?.[0];
      const rEmbed = blip?.$?.['r:embed'];
      
      let imagePath = '';
      if (rEmbed) {
        const rel = this.findRelationshipTarget(`slide${slideNumber}`, rEmbed);
        if (rel) {
          imagePath = rel.target;
        }
      }
      
      return {
        id: `${id}_${name}`,
        type: 'image',
        position,
        size,
        content: {
          imagePath,
          originalSize: size,
          aspectRatio: size.width / size.height
        },
        style: this.extractElementStyle(spPr)
      };
    } catch (error) {
      console.warn('Error parsing picture:', error);
      return null;
    }
  }

  /**
   * Parse a chart element
   */
  private async parseChart(chart: any, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = chart?.['p:nvGraphicFramePr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = chart?.['p:nvGraphicFramePr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'chart';
      
      // Extract position and size
      const xfrm = chart?.['p:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      return {
        id: `${id}_${name}`,
        type: 'chart',
        position,
        size,
        content: {
          chartType: 'unknown', // Would need deeper parsing
          data: null,
          series: []
        }
      };
    } catch (error) {
      console.warn('Error parsing chart:', error);
      return null;
    }
  }

  // Helper methods
  private extractPosition(xfrm: any): ElementPosition {
    try {
      const off = xfrm?.['a:off']?.[0];
      return {
        x: parseInt(off?.$.x || '0'),
        y: parseInt(off?.$.y || '0'),
        z: 0
      };
    } catch {
      return { x: 0, y: 0, z: 0 };
    }
  }

  private extractSize(xfrm: any): ElementSize {
    try {
      const ext = xfrm?.['a:ext']?.[0];
      return {
        width: parseInt(ext?.$.cx || '0'),
        height: parseInt(ext?.$.cy || '0')
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  private extractElementStyle(spPr: any, textBody?: any): ElementStyle {
    const style: ElementStyle = {};
    
    try {
      // Extract fill color
      const solidFill = spPr?.['a:solidFill']?.[0];
      if (solidFill) {
        // This is simplified - real implementation would handle various color formats
        style.fill = '#000000';
      }
      
      // Extract font information from text body
      if (textBody) {
        const defRPr = textBody?.['a:lstStyle']?.[0]?.['a:lvl1pPr']?.[0]?.['a:defRPr']?.[0];
        if (defRPr) {
          style.font = this.extractFontInfo(defRPr);
        }
      }
    } catch {
      // Style extraction failed
    }
    
    return style;
  }

  private extractFontInfo(rPr: any): FontInfo {
    return {
      family: rPr?.['a:latin']?.[0]?.$.typeface || 'Arial',
      size: parseInt(rPr?.$.sz || '1800') / 100, // Convert from hundredths of points
      color: '#000000', // Simplified
      bold: rPr?.$.b === '1',
      italic: rPr?.$.i === '1',
      underline: rPr?.$.u !== undefined
    };
  }

  private extractTextFromBody(textBody: any): string {
    try {
      const paragraphs = textBody?.['a:p'];
      if (paragraphs && Array.isArray(paragraphs)) {
        return paragraphs
          .map((p: any) => this.extractTextFromParagraph(p))
          .filter(text => text.length > 0)
          .join('\n');
      }
    } catch {
      // Text extraction failed
    }
    return '';
  }

  private extractParagraphsFromBody(textBody: any): TextParagraph[] {
    const paragraphs: TextParagraph[] = [];
    
    try {
      const pArray = textBody?.['a:p'];
      if (pArray && Array.isArray(pArray)) {
        for (const p of pArray) {
          const text = this.extractTextFromParagraph(p);
          if (text) {
            paragraphs.push({
              text,
              runs: this.extractTextRuns(p),
              alignment: this.extractAlignment(p),
              level: parseInt(p?.['a:pPr']?.[0]?.$.lvl || '0')
            });
          }
        }
      }
    } catch {
      // Paragraph extraction failed
    }
    
    return paragraphs;
  }

  private extractTextFromParagraph(p: any): string {
    try {
      const runs = p?.['a:r'] || [];
      return runs
        .map((run: any) => run?.['a:t']?.[0] || '')
        .join('');
    } catch {
      return '';
    }
  }

  private extractTextRuns(p: any): TextRun[] {
    const runs: TextRun[] = [];
    
    try {
      const runArray = p?.['a:r'];
      if (runArray && Array.isArray(runArray)) {
        for (const run of runArray) {
          const text = run?.['a:t']?.[0] || '';
          if (text) {
            runs.push({
              text,
              font: this.extractFontInfo(run?.['a:rPr']?.[0])
            });
          }
        }
      }
    } catch {
      // Run extraction failed
    }
    
    return runs;
  }

  private extractAlignment(p: any): 'left' | 'center' | 'right' | 'justify' {
    try {
      const algn = p?.['a:pPr']?.[0]?.$.algn;
      switch (algn) {
        case 'ctr': return 'center';
        case 'r': return 'right';
        case 'just': return 'justify';
        default: return 'left';
      }
    } catch {
      return 'left';
    }
  }

  private extractShapeType(spPr: any): string {
    try {
      const prstGeom = spPr?.['a:prstGeom']?.[0];
      return prstGeom?.$.prst || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private extractShapeGeometry(spPr: any): any {
    try {
      const custGeom = spPr?.['a:custGeom']?.[0];
      if (custGeom) {
        return custGeom;
      }
      
      const prstGeom = spPr?.['a:prstGeom']?.[0];
      if (prstGeom) {
        return { preset: prstGeom.$.prst };
      }
    } catch {
      // Geometry extraction failed
    }
    return null;
  }

  private findRelationshipTarget(sourceId: string, relationshipId: string): { target: string; type: string } | null {
    try {
      const rels = this.relationships.get(sourceId);
      if (rels?.Relationships?.Relationship) {
        const relationships = Array.isArray(rels.Relationships.Relationship) 
          ? rels.Relationships.Relationship 
          : [rels.Relationships.Relationship];
          
        for (const rel of relationships) {
          if (rel.$.Id === relationshipId) {
            return {
              target: rel.$.Target,
              type: rel.$.Type
            };
          }
        }
      }
    } catch {
      // Relationship lookup failed
    }
    return null;
  }

  private createPlaceholderSlide(slideId: string, slideNumber: number): SlideLayout {
    return {
      slideId,
      slideNumber,
      title: `Slide ${slideNumber}`,
      elements: [],
      dimensions: {
        width: 12192000,
        height: 6858000,
        units: 'EMU'
      }
    };
  }

  private async getXmlContent(path: string): Promise<string> {
    const file = this.zip?.file(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return await file.async('string');
  }
}