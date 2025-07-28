#!/usr/bin/env node

const convert = require('./src/index.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('📄 Doc-to-Markdown Converter CLI\n');
    console.log('Usage:');
    console.log('  node cli.js <file-path> [output-file] [--images-dir=<dir>]');
    console.log('');
    console.log('Examples:');
    console.log('  node cli.js document.pdf');
    console.log('  node cli.js document.docx output.md');
    console.log('  node cli.js presentation.pptx --images-dir=extracted-images');
    console.log('  node cli.js /path/to/presentation.pptx output.md --images-dir=./images');
    console.log('');
    console.log('Supported formats: PDF, DOCX, XLSX, PPTX');
    process.exit(0);
  }

  // Parse arguments
  let inputFile = '';
  let outputFile = '';
  let imageDir = 'images';
  
  for (const arg of args) {
    if (arg.startsWith('--images-dir=')) {
      imageDir = arg.split('=')[1];
    } else if (!inputFile) {
      inputFile = arg;
    } else if (!outputFile) {
      outputFile = arg;
    }
  }

  console.log(`🔄 Converting: ${inputFile}`);
  console.log('⏳ Processing...\n');

  try {
    const startTime = Date.now();
    const markdown = await convert(inputFile, { imageDir });
    const endTime = Date.now();

    console.log(`✅ Conversion successful!`);
    console.log(`⏱️  Time taken: ${endTime - startTime}ms`);
    console.log(`📊 Output length: ${markdown.length} characters`);
    console.log(`🖼️  Images saved to: ${imageDir}/`);
    
    if (outputFile) {
      // Save to specified output file
      fs.writeFileSync(outputFile, markdown);
      console.log(`💾 Saved to: ${outputFile}`);
    } else {
      // Save to auto-generated filename
      const inputName = path.parse(inputFile).name;
      const autoOutputFile = `${inputName}.md`;
      fs.writeFileSync(autoOutputFile, markdown);
      console.log(`💾 Saved to: ${autoOutputFile}`);
    }

    console.log('\n📝 Preview (first 300 characters):');
    console.log('─'.repeat(50));
    console.log(markdown.substring(0, 300));
    if (markdown.length > 300) {
      console.log('...\n(truncated)');
    }
    console.log('─'.repeat(50));

  } catch (error) {
    console.error('❌ Conversion failed:', error.message);
    process.exit(1);
  }
}

main();