import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { ParseError } from '../types/errors.js';

// Visual element types
export interface SlideLayout {
  slideId: string;
  slideNumber: number;
  title?: string;
  background?: BackgroundInfo;
  elements: readonly VisualElement[];
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
  colors?: readonly string[]; // For gradients
  imagePath?: string;
}

export interface VisualElement {
  id: string;
  type: 'text' | 'shape' | 'image' | 'chart' | 'table' | 'group';
  position: ElementPosition;
  size: ElementSize;
  content?: unknown;
  style?: ElementStyle;
  children?: readonly VisualElement[]; // For groups
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
    paragraphs: readonly TextParagraph[];
  };
}

export interface TextParagraph {
  text: string;
  runs: readonly TextRun[];
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
    geometry?: unknown;
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
    data?: unknown;
    series?: readonly unknown[];
  };
}

export interface TableElement extends VisualElement {
  type: 'table';
  content: {
    rows: readonly TableRow[];
    columnWidths: readonly number[];
    style?: TableStyle;
  };
}

export interface TableRow {
  cells: readonly TableCell[];
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
  private relationships = new Map<string, unknown>();
  private themes = new Map<string, unknown>();

  /**
   * Parse PPTX buffer to extract comprehensive visual information
   */
  async parseVisualElements(pptxBuffer: Buffer): Promise<readonly SlideLayout[]> {
    try {
      // Load PPTX as ZIP
      this.zip = await JSZip.loadAsync(pptxBuffer);
      
      // Parse presentation structure
      const presentationXml = await this.getXmlContent('ppt/presentation.xml');
      const presentation = await parseStringPromise(presentationXml);
      
      // Extract slide references
      const slideIds = this.extractSlideReferences(presentation);
      this.slideCount = slideIds.length;

      // Load relationships and themes
      await this.loadRelationships();
      await this.loadThemes();

      // Parse each slide
      const slides: SlideLayout[] = [];
      
      for (const [i, slideId] of slideIds.entries()) {
        try {
          const slide = await this.parseSlide(slideId.id, slideId.rId, i + 1);
          slides.push(slide);
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
  private extractSlideReferences(presentation: unknown): readonly {id: string, rId: string}[] {
    const slideIds: {id: string, rId: string}[] = [];
    
    try {
      const slideIdList = (presentation as { 'p:presentation'?: { 'p:sldIdLst'?: readonly { 'p:sldId'?: readonly { $: { id: string, 'r:id': string } }[] }[] } })?.['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId'];
      
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
  private async parseSlide(_slideId: string, rId: string, slideNumber: number): Promise<SlideLayout> {
    // Get slide path from relationships
    const slideRel = this.findRelationshipTarget('presentation', rId);
    const slidePath = slideRel ? `ppt/${slideRel.target}` : `ppt/slides/slide${slideNumber}.xml`;
    
    // Load slide XML
    const slideXml = await this.getXmlContent(slidePath);
    const slideDoc = await parseStringPromise(slideXml);
    
    // Extract slide dimensions
    const dimensions = this.extractSlideDimensions();
    
    // Extract background
    const background = this.extractSlideBackground(slideDoc);
    
    // Extract title
    const title = this.extractSlideTitle(slideDoc);
    
    // Parse visual elements
    const elements = await this.parseSlideElements(slideDoc, slideNumber);
    
    return {
      slideId: _slideId,
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
  private extractSlideDimensions(): SlideDimensions {
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
  private extractSlideBackground(slideDoc: unknown): BackgroundInfo | undefined {
    try {
      const bg = (slideDoc as { 'p:sld'?: { 'p:cSld'?: readonly { 'p:bg'?: unknown }[] } })?.['p:sld']?.['p:cSld']?.[0]?.['p:bg'];
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
  private extractSlideTitle(slideDoc: unknown): string | undefined {
    try {
      const shapes = (slideDoc as { 'p:sld'?: { 'p:cSld'?: readonly { 'p:spTree'?: readonly { 'p:sp'?: readonly unknown[] }[] }[] } })?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0]?.['p:sp'];
      
      if (shapes && Array.isArray(shapes)) {
        for (const shape of shapes) {
          const nvSpPr = (shape as { 'p:nvSpPr'?: readonly unknown[] })?.['p:nvSpPr']?.[0];
          const ph = (nvSpPr as { 'p:nvPr'?: readonly { 'p:ph'?: readonly { $: { type: string } }[] }[] })?.['p:nvPr']?.[0]?.['p:ph']?.[0];
          
          if (ph?.$ && ph.$.type === 'title') {
            // Extract text from title shape
            const textBody = (shape as { 'p:txBody'?: readonly unknown[] })?.['p:txBody']?.[0];
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
  private async parseSlideElements(slideDoc: unknown, slideNumber: number): Promise<readonly VisualElement[]> {
    const elements: VisualElement[] = [];
    
    try {
      const spTree = (slideDoc as { 'p:sld'?: { 'p:cSld'?: readonly { 'p:spTree'?: readonly { 'p:sp'?: readonly unknown[], 'p:grpSp'?: readonly unknown[], 'p:pic'?: readonly unknown[], 'p:graphicFrame'?: readonly unknown[] }[] }[] } })?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0];
      
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
          const element = await this.parseChart(chart);
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
  private async parseShape(shape: unknown, _slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = (shape as { 'p:nvSpPr'?: readonly { 'p:cNvPr'?: readonly { $: { id: string, name: string } }[] }[] })?.['p:nvSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = (shape as { 'p:nvSpPr'?: readonly { 'p:cNvPr'?: readonly { $: { name: string } }[] }[] })?.['p:nvSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'shape';
      
      // Extract position and size
      const spPr = (shape as { 'p:spPr'?: readonly unknown[] })?.['p:spPr']?.[0];
      const xfrm = (spPr as { 'a:xfrm'?: readonly unknown[] })?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Check if it has text content
      const textBody = (shape as { 'p:txBody'?: readonly unknown[] })?.['p:txBody']?.[0];
      
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
  private async parseGroup(group: unknown, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = (group as { 'p:nvGrpSpPr'?: readonly { 'p:cNvPr'?: readonly { $: { id: string, name: string } }[] }[] })?.['p:nvGrpSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = (group as { 'p:nvGrpSpPr'?: readonly { 'p:cNvPr'?: readonly { $: { name: string } }[] }[] })?.['p:nvGrpSpPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'group';
      
      // Extract position and size
      const grpSpPr = (group as { 'p:grpSpPr'?: readonly unknown[] })?.['p:grpSpPr']?.[0];
      const xfrm = (grpSpPr as { 'a:xfrm'?: readonly unknown[] })?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Parse child elements
      const children: VisualElement[] = [];
      
      // Child shapes
      const shapes = (group as { 'p:sp'?: readonly unknown[] })['p:sp'];
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
  private async parsePicture(pic: unknown, slideNumber: number): Promise<VisualElement | null> {
    try {
      const id = (pic as { 'p:nvPicPr'?: readonly { 'p:cNvPr'?: readonly { $: { id: string, name: string } }[] }[] })?.['p:nvPicPr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = (pic as { 'p:nvPicPr'?: readonly { 'p:cNvPr'?: readonly { $: { name: string } }[] }[] })?.['p:nvPicPr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'image';
      
      // Extract position and size
      const spPr = (pic as { 'p:spPr'?: readonly unknown[] })?.['p:spPr']?.[0];
      const xfrm = (spPr as { 'a:xfrm'?: readonly unknown[] })?.['a:xfrm']?.[0];
      const position = this.extractPosition(xfrm);
      const size = this.extractSize(xfrm);
      
      // Extract image reference
      const blip = (pic as { 'p:blipFill'?: readonly { 'a:blip'?: readonly { $: { 'r:embed': string } }[] }[] })?.['p:blipFill']?.[0]?.['a:blip']?.[0];
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
  private async parseChart(chart: unknown): Promise<VisualElement | null> {
    try {
      const id = (chart as { 'p:nvGraphicFramePr'?: readonly { 'p:cNvPr'?: readonly { $: { id: string, name: string } }[] }[] })?.['p:nvGraphicFramePr']?.[0]?.['p:cNvPr']?.[0]?.$.id || 'unknown';
      const name = (chart as { 'p:nvGraphicFramePr'?: readonly { 'p:cNvPr'?: readonly { $: { name: string } }[] }[] })?.['p:nvGraphicFramePr']?.[0]?.['p:cNvPr']?.[0]?.$.name || 'chart';
      
      // Extract position and size
      const xfrm = (chart as { 'p:xfrm'?: readonly unknown[] })?.['p:xfrm']?.[0];
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
  private extractPosition(xfrm: unknown): ElementPosition {
    try {
      const off = (xfrm as { 'a:off'?: readonly { $: { x: string, y: string } }[] })?.['a:off']?.[0];
      return {
        x: parseInt(off?.$.x || '0', 10),
        y: parseInt(off?.$.y || '0', 10),
        z: 0
      };
    } catch {
      return { x: 0, y: 0, z: 0 };
    }
  }

  private extractSize(xfrm: unknown): ElementSize {
    try {
      const ext = (xfrm as { 'a:ext'?: readonly { $: { cx: string, cy: string } }[] })?.['a:ext']?.[0];
      return {
        width: parseInt(ext?.$.cx || '0', 10),
        height: parseInt(ext?.$.cy || '0', 10)
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  private extractElementStyle(spPr: unknown, textBody?: unknown): ElementStyle {
    const style: ElementStyle = {};
    
    try {
      // Extract fill color
      const solidFill = (spPr as { 'a:solidFill'?: readonly unknown[] })?.['a:solidFill']?.[0];
      if (solidFill) {
        // This is simplified - real implementation would handle various color formats
        style.fill = '#000000';
      }
      
      // Extract font information from text body
      if (textBody) {
        const defRPr = (textBody as { 'a:lstStyle'?: readonly { 'a:lvl1pPr'?: readonly { 'a:defRPr'?: readonly unknown[] }[] }[] })?.['a:lstStyle']?.[0]?.['a:lvl1pPr']?.[0]?.['a:defRPr']?.[0];
        if (defRPr) {
          style.font = this.extractFontInfo(defRPr);
        }
      }
    } catch {
      // Style extraction failed
    }
    
    return style;
  }

  private extractFontInfo(rPr: unknown): FontInfo {
    return {
      family: (rPr as { 'a:latin'?: readonly { $: { typeface: string } }[] })?.['a:latin']?.[0]?.$.typeface || 'Arial',
      size: parseInt((rPr as { $: { sz: string } })?.$.sz || '1800', 10) / 100, // Convert from hundredths of points
      color: '#000000', // Simplified
      bold: (rPr as { $: { b: string } })?.$.b === '1',
      italic: (rPr as { $: { i: string } })?.$.i === '1',
      underline: (rPr as { $: { u: string } })?.$.u !== undefined
    };
  }

  private extractTextFromBody(textBody: unknown): string {
    try {
      const paragraphs = (textBody as { 'a:p'?: readonly unknown[] })?.['a:p'];
      if (paragraphs && Array.isArray(paragraphs)) {
        return paragraphs
          .map((p) => this.extractTextFromParagraph(p))
          .filter(text => text.length > 0)
          .join('\n');
      }
    } catch {
      // Text extraction failed
    }
    return '';
  }

  private extractParagraphsFromBody(textBody: unknown): readonly TextParagraph[] {
    const paragraphs: TextParagraph[] = [];
    
    try {
      const pArray = (textBody as { 'a:p'?: readonly unknown[] })?.['a:p'];
      if (pArray && Array.isArray(pArray)) {
        for (const p of pArray) {
          const text = this.extractTextFromParagraph(p);
          if (text) {
            paragraphs.push({
              text,
              runs: this.extractTextRuns(p),
              alignment: this.extractAlignment(p),
              level: parseInt((p as { 'a:pPr'?: readonly { $: { lvl: string } }[] })?.['a:pPr']?.[0]?.$.lvl || '0', 10)
            });
          }
        }
      }
    } catch {
      // Paragraph extraction failed
    }
    
    return paragraphs;
  }

  private extractTextFromParagraph(p: unknown): string {
    try {
      const runs = (p as { 'a:r'?: readonly { 'a:t'?: readonly [string] }[] })?.['a:r'] || [];
      return runs
        .map((run) => run?.['a:t']?.[0] || '')
        .join('');
    } catch {
      return '';
    }
  }

  private extractTextRuns(p: unknown): readonly TextRun[] {
    const runs: TextRun[] = [];
    
    try {
      const runArray = (p as { 'a:r'?: readonly { 'a:t'?: readonly [string], 'a:rPr'?: readonly unknown[] }[] })?.['a:r'];
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

  private extractAlignment(p: unknown): 'left' | 'center' | 'right' | 'justify' {
    try {
      const algn = (p as { 'a:pPr'?: readonly { $: { algn: string } }[] })?.['a:pPr']?.[0]?.$.algn;
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

  private extractShapeType(spPr: unknown): string {
    try {
      const prstGeom = (spPr as { 'a:prstGeom'?: readonly { $: { prst: string } }[] })?.['a:prstGeom']?.[0];
      return prstGeom?.$.prst || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private extractShapeGeometry(spPr: unknown): unknown {
    try {
      const custGeom = (spPr as { 'a:custGeom'?: readonly unknown[] })?.['a:custGeom']?.[0];
      if (custGeom) {
        return custGeom;
      }
      
      const prstGeom = (spPr as { 'a:prstGeom'?: readonly { $: { prst: string } }[] })?.['a:prstGeom']?.[0];
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
      const rels = this.relationships.get(sourceId) as { Relationships?: { Relationship?: { $: { Id: string, Target: string, Type: string } }[] | { $: { Id: string, Target: string, Type: string } } } };
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
