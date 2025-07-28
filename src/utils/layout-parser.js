class LayoutParser {
  constructor() {
    this.tableCounter = 0;
  }

  // Enhanced table parsing with merged cells and styling
  parseAdvancedTable(tableData, options = {}) {
    if (!tableData || !tableData.rows || tableData.rows.length === 0) {
      return '';
    }

    const { 
      preserveAlignment = true, 
      showBorders = true,
      preserveColors = false 
    } = options;

    let markdown = '';
    const rows = tableData.rows;
    const colCount = Math.max(...rows.map(row => row.cells ? row.cells.length : 0));

    // Process each row
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      let rowMarkdown = '|';
      
      if (!row.cells) continue;

      // Process each cell
      for (let colIndex = 0; colIndex < colCount; colIndex++) {
        const cell = row.cells[colIndex] || {};
        let cellContent = cell.text || '';
        
        // Handle merged cells
        if (cell.merged) {
          if (cell.colSpan > 1) {
            // For horizontal merge, add extra columns
            cellContent += ' '.repeat(Math.max(0, cell.colSpan - 1) * 3);
          }
          // Note: Markdown doesn't support rowspan, so we approximate
        }

        // Apply text formatting
        if (cell.bold) cellContent = `**${cellContent}**`;
        if (cell.italic) cellContent = `*${cellContent}*`;
        
        // Apply alignment (approximate with spaces)
        if (preserveAlignment && cell.alignment) {
          const cellWidth = Math.max(cellContent.length, 10);
          switch (cell.alignment) {
            case 'center':
              const padding = Math.floor((cellWidth - cellContent.length) / 2);
              cellContent = ' '.repeat(padding) + cellContent + ' '.repeat(padding);
              break;
            case 'right':
              cellContent = cellContent.padStart(cellWidth);
              break;
          }
        }

        // Add background color note if enabled
        if (preserveColors && cell.backgroundColor) {
          cellContent += ` <!-- bg:${cell.backgroundColor} -->`;
        }

        rowMarkdown += ` ${cellContent} |`;
      }

      markdown += rowMarkdown + '\n';

      // Add header separator after first row
      if (rowIndex === 0) {
        let separator = '|';
        for (let i = 0; i < colCount; i++) {
          const cell = rows[0].cells[i] || {};
          let sepContent = ' --- ';
          
          // Apply alignment in separator
          if (preserveAlignment && cell.alignment) {
            switch (cell.alignment) {
              case 'center':
                sepContent = ':---:';
                break;
              case 'right':
                sepContent = ' ---:';
                break;
              case 'left':
              default:
                sepContent = ':--- ';
                break;
            }
          }
          separator += sepContent + '|';
        }
        markdown += separator + '\n';
      }
    }

    return markdown;
  }

  // Parse lists with proper nesting
  parseList(listData, isOrdered = false) {
    if (!listData || !listData.items) return '';

    let markdown = '';
    
    const processListItems = (items, level = 0) => {
      for (const item of items) {
        const indent = '  '.repeat(level);
        const marker = isOrdered ? '1.' : '-';
        
        let itemText = item.text || '';
        
        // Apply formatting
        if (item.bold) itemText = `**${itemText}**`;
        if (item.italic) itemText = `*${itemText}*`;
        
        markdown += `${indent}${marker} ${itemText}\n`;
        
        // Handle nested lists
        if (item.children && item.children.length > 0) {
          markdown += processListItems(item.children, level + 1);
        }
      }
      return markdown;
    };

    return processListItems(listData.items);
  }

  // Create text box representation
  createTextBox(content, position = {}) {
    const { x, y, width, height } = position;
    let markdown = '';
    
    if (x || y) {
      markdown += `<!-- Position: x=${x || 0}, y=${y || 0} -->\n`;
    }
    
    markdown += '> **Text Box**\n';
    markdown += '> \n';
    
    // Split content into lines and add blockquote formatting
    const lines = content.split('\n');
    for (const line of lines) {
      markdown += `> ${line}\n`;
    }
    
    return markdown + '\n';
  }

  // Create multi-column layout approximation
  createColumns(columns) {
    if (!columns || columns.length <= 1) {
      return columns[0]?.content || '';
    }

    let markdown = '<!-- Multi-column layout -->\n\n';
    
    // Create a table to approximate columns
    markdown += '|';
    for (let i = 0; i < columns.length; i++) {
      markdown += ` Column ${i + 1} |`;
    }
    markdown += '\n';
    
    markdown += '|';
    for (let i = 0; i < columns.length; i++) {
      markdown += ' --- |';
    }
    markdown += '\n';
    
    // Find the maximum number of paragraphs in any column
    const maxParagraphs = Math.max(...columns.map(col => 
      col.content ? col.content.split('\n\n').length : 0
    ));
    
    // Create rows for each paragraph level
    for (let p = 0; p < maxParagraphs; p++) {
      markdown += '|';
      for (const column of columns) {
        const paragraphs = column.content ? column.content.split('\n\n') : [];
        const paragraph = paragraphs[p] || '';
        markdown += ` ${paragraph.replace(/\n/g, '<br>')} |`;
      }
      markdown += '\n';
    }
    
    return markdown + '\n';
  }

  // Parse headers and footers
  parseHeaderFooter(content, type = 'header') {
    if (!content) return '';
    
    const marker = type === 'header' ? '🔝' : '🔻';
    return `<!-- Document ${type} -->\n> ${marker} ${content}\n\n`;
  }

  // Create divider/separator
  createDivider(style = 'simple') {
    switch (style) {
      case 'thick':
        return '\n═══════════════════════════════════════\n\n';
      case 'dashed':
        return '\n---\n\n';
      case 'dotted':
        return '\n• • • • • • • • • • • • • • • • • • • • •\n\n';
      default:
        return '\n---\n\n';
    }
  }

  // Calculate relative positioning
  calculateRelativePosition(elements) {
    // Sort elements by their Y position, then X position
    return elements.sort((a, b) => {
      const yDiff = (a.position?.y || 0) - (b.position?.y || 0);
      if (Math.abs(yDiff) < 50) { // Same "row"
        return (a.position?.x || 0) - (b.position?.x || 0);
      }
      return yDiff;
    });
  }

  // Format with approximate font sizes using headers
  formatWithSize(text, fontSize) {
    if (!fontSize || fontSize === 'normal') return text;
    
    // Map font sizes to markdown headers (approximate)
    if (fontSize >= 24) return `# ${text}`;
    if (fontSize >= 20) return `## ${text}`;
    if (fontSize >= 16) return `### ${text}`;
    if (fontSize >= 14) return `#### ${text}`;
    if (fontSize <= 10) return `<small>${text}</small>`;
    
    return text;
  }

  reset() {
    this.tableCounter = 0;
  }
}

module.exports = LayoutParser;