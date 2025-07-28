const xml2js = require('xml2js');

class ChartExtractor {
  constructor(imageExtractor) {
    this.imageExtractor = imageExtractor;
    this.chartCounter = 0;
  }

  async extractChartsFromZip(zip, basePath = '') {
    const charts = [];
    
    zip.forEach((relativePath, file) => {
      // Look for chart files
      if (relativePath.includes('/charts/') && relativePath.endsWith('.xml')) {
        charts.push({
          path: relativePath,
          file: file,
          basePath: basePath
        });
      }
    });

    const extractedCharts = [];
    for (const chart of charts) {
      try {
        const chartData = await this.parseChart(chart.file);
        if (chartData) {
          extractedCharts.push({
            originalPath: chart.path,
            data: chartData,
            basePath: chart.basePath
          });
        }
      } catch (error) {
        console.warn(`Failed to extract chart ${chart.path}:`, error.message);
      }
    }

    return extractedCharts;
  }

  async parseChart(chartFile) {
    try {
      const xmlContent = await chartFile.async('string');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      
      const chartData = {
        type: 'unknown',
        title: '',
        data: [],
        categories: [],
        series: []
      };

      // Extract chart type
      if (result['c:chartSpace']) {
        const chart = result['c:chartSpace']['c:chart'][0];
        
        // Extract title
        if (chart['c:title'] && chart['c:title'][0]['c:tx']) {
          chartData.title = this.extractTextFromTitle(chart['c:title'][0]['c:tx'][0]);
        }

        // Extract plot area
        if (chart['c:plotArea']) {
          const plotArea = chart['c:plotArea'][0];
          
          // Determine chart type and extract data
          if (plotArea['c:barChart']) {
            chartData.type = 'bar';
            chartData.data = this.extractBarChartData(plotArea['c:barChart'][0]);
          } else if (plotArea['c:lineChart']) {
            chartData.type = 'line';
            chartData.data = this.extractLineChartData(plotArea['c:lineChart'][0]);
          } else if (plotArea['c:pieChart']) {
            chartData.type = 'pie';
            chartData.data = this.extractPieChartData(plotArea['c:pieChart'][0]);
          } else if (plotArea['c:scatterChart']) {
            chartData.type = 'scatter';
            chartData.data = this.extractScatterChartData(plotArea['c:scatterChart'][0]);
          }
        }
      }

      return chartData;
    } catch (error) {
      console.warn('Failed to parse chart:', error.message);
      return null;
    }
  }

  extractTextFromTitle(titleData) {
    // Simplified title extraction
    if (titleData['c:rich'] && titleData['c:rich'][0]['a:p']) {
      const paragraphs = titleData['c:rich'][0]['a:p'];
      let title = '';
      for (const para of paragraphs) {
        if (para['a:r'] && para['a:r'][0] && para['a:r'][0]['a:t']) {
          title += para['a:r'][0]['a:t'][0] + ' ';
        }
      }
      return title.trim();
    }
    return '';
  }

  extractBarChartData(barChart) {
    const data = [];
    
    if (barChart['c:ser']) {
      for (const series of barChart['c:ser']) {
        const seriesData = {
          name: '',
          values: [],
          categories: []
        };
        
        // Extract series name
        if (series['c:tx'] && series['c:tx'][0]['c:strRef']) {
          // Series name from string reference
          const strRef = series['c:tx'][0]['c:strRef'][0];
          if (strRef['c:strCache'] && strRef['c:strCache'][0]['c:pt']) {
            seriesData.name = strRef['c:strCache'][0]['c:pt'][0]['c:v'][0];
          }
        }
        
        // Extract values
        if (series['c:val'] && series['c:val'][0]['c:numRef']) {
          const numRef = series['c:val'][0]['c:numRef'][0];
          if (numRef['c:numCache'] && numRef['c:numCache'][0]['c:pt']) {
            for (const pt of numRef['c:numCache'][0]['c:pt']) {
              seriesData.values.push(parseFloat(pt['c:v'][0]) || 0);
            }
          }
        }
        
        // Extract categories
        if (series['c:cat'] && series['c:cat'][0]['c:strRef']) {
          const strRef = series['c:cat'][0]['c:strRef'][0];
          if (strRef['c:strCache'] && strRef['c:strCache'][0]['c:pt']) {
            for (const pt of strRef['c:strCache'][0]['c:pt']) {
              seriesData.categories.push(pt['c:v'][0]);
            }
          }
        }
        
        data.push(seriesData);
      }
    }
    
    return data;
  }

  extractLineChartData(lineChart) {
    // Similar to bar chart but for line charts
    return this.extractBarChartData(lineChart);
  }

  extractPieChartData(pieChart) {
    const data = [];
    
    if (pieChart['c:ser']) {
      const series = pieChart['c:ser'][0];
      const seriesData = {
        name: 'Pie Chart',
        values: [],
        categories: []
      };
      
      // Extract values and categories for pie chart
      if (series['c:val'] && series['c:val'][0]['c:numRef']) {
        const numRef = series['c:val'][0]['c:numRef'][0];
        if (numRef['c:numCache'] && numRef['c:numCache'][0]['c:pt']) {
          for (const pt of numRef['c:numCache'][0]['c:pt']) {
            seriesData.values.push(parseFloat(pt['c:v'][0]) || 0);
          }
        }
      }
      
      if (series['c:cat'] && series['c:cat'][0]['c:strRef']) {
        const strRef = series['c:cat'][0]['c:strRef'][0];
        if (strRef['c:strCache'] && strRef['c:strCache'][0]['c:pt']) {
          for (const pt of strRef['c:strCache'][0]['c:pt']) {
            seriesData.categories.push(pt['c:v'][0]);
          }
        }
      }
      
      data.push(seriesData);
    }
    
    return data;
  }

  extractScatterChartData(scatterChart) {
    // Simplified scatter chart extraction
    return this.extractBarChartData(scatterChart);
  }

  formatChartAsMarkdown(chartData) {
    this.chartCounter++;
    let markdown = `#### Chart ${this.chartCounter}: ${chartData.title || chartData.type.toUpperCase() + ' Chart'}\n\n`;
    
    if (chartData.data.length === 0) {
      return markdown + '*No chart data available*\n\n';
    }

    switch (chartData.type) {
      case 'bar':
      case 'line':
        markdown += this.formatBarLineChart(chartData);
        break;
      case 'pie':
        markdown += this.formatPieChart(chartData);
        break;
      default:
        markdown += this.formatGenericChart(chartData);
    }

    return markdown + '\n';
  }

  formatBarLineChart(chartData) {
    let markdown = '| Category |';
    
    // Add series headers
    for (const series of chartData.data) {
      markdown += ` ${series.name || 'Series'} |`;
    }
    markdown += '\n';
    
    // Add separator
    markdown += '| --- |';
    for (let i = 0; i < chartData.data.length; i++) {
      markdown += ' --- |';
    }
    markdown += '\n';
    
    // Find maximum number of categories
    const maxCategories = Math.max(...chartData.data.map(s => s.categories.length));
    
    // Add data rows
    for (let i = 0; i < maxCategories; i++) {
      const category = chartData.data[0]?.categories[i] || `Item ${i + 1}`;
      markdown += `| ${category} |`;
      
      for (const series of chartData.data) {
        const value = series.values[i] || 0;
        markdown += ` ${value} |`;
      }
      markdown += '\n';
    }
    
    return markdown;
  }

  formatPieChart(chartData) {
    const series = chartData.data[0];
    if (!series) return '*No pie chart data*\n';
    
    let markdown = '| Category | Value | Percentage |\n';
    markdown += '| --- | --- | --- |\n';
    
    const total = series.values.reduce((sum, val) => sum + val, 0);
    
    for (let i = 0; i < series.categories.length; i++) {
      const category = series.categories[i];
      const value = series.values[i] || 0;
      const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
      
      markdown += `| ${category} | ${value} | ${percentage}% |\n`;
    }
    
    return markdown;
  }

  formatGenericChart(chartData) {
    let markdown = `*${chartData.type.toUpperCase()} chart with ${chartData.data.length} series*\n\n`;
    
    for (let i = 0; i < chartData.data.length; i++) {
      const series = chartData.data[i];
      markdown += `**Series ${i + 1}: ${series.name}**\n`;
      markdown += `Values: ${series.values.join(', ')}\n`;
      if (series.categories.length > 0) {
        markdown += `Categories: ${series.categories.join(', ')}\n`;
      }
      markdown += '\n';
    }
    
    return markdown;
  }

  reset() {
    this.chartCounter = 0;
  }
}

module.exports = ChartExtractor;