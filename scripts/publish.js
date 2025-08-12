#!/usr/bin/env node

/**
 * Custom npm publish script with automatic version increment
 * 
 * Prerequisites:
 * - Set NPM_TOKEN environment variable: export NPM_TOKEN=xxxxxxxx-...
 * - Configure npm: npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
 * 
 * Usage:
 * npm run publish
 * npm run publish:dry
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Execute a command and return a promise
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: true,
      ...options
    });
    
    let stdout = '';
    
    child.stdout?.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);
      stdout += output;
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  try {
    // Prevent recursive calls
    if (process.env.PUBLISHING_IN_PROGRESS) {
      console.log('🔄 Already publishing - preventing recursive call');
      return;
    }
    
    // Set flag to prevent recursion
    process.env.PUBLISHING_IN_PROGRESS = 'true';
    
    console.log('🚀 Starting automated npm publish...');
    
    // Check if NPM_TOKEN is set
    if (!process.env.NPM_TOKEN) {
      console.warn('⚠️  NPM_TOKEN environment variable not set');
      console.log('💡 Consider setting it with: $env:NPM_TOKEN = "your-token"');
    }
    
    // Check npm authentication
    console.log('🔐 Checking npm authentication...');
    try {
      const whoami = await execCommand('npm', ['whoami']);
      console.log(`✅ Authenticated as: ${whoami.trim()}`);
    } catch (authError) {
      console.error('❌ npm authentication failed');
      console.error('💡 Make sure you have set your auth token:');
      console.error('   $env:NPM_TOKEN = "your-token"');
      console.error('   npm config set //registry.npmjs.org/:_authToken=$env:NPM_TOKEN');
      throw authError;
    }
    
    // Get command line arguments (everything after the script name)
    const publishArgs = process.argv.slice(2);
    
    console.log('📋 Publish arguments:', publishArgs.length > 0 ? publishArgs.join(' ') : 'none');
    
    // Check if we should skip version increment (for retries)
    const skipIncrement = publishArgs.includes('--skip-increment') || publishArgs.includes('--dry-run');
    
    // Step 1: Increment versions (unless --dry-run or --skip-increment)
    if (!skipIncrement) {
      console.log('\n📈 Step 1: Incrementing versions...');
      await execCommand('node', [path.join(__dirname, 'increment-version.js')]);
    } else {
      console.log('\n📈 Step 1: Skipping version increment');
    }
    
    // Step 2: Run prepublish checks (clean, build, test)
    console.log('\n🔍 Step 2: Running prepublish checks...');
    await execCommand('npm', ['run', 'prepublishOnly']);
    
    // Step 3: Publish with any provided arguments (filter out our custom flags)
    console.log('\n📦 Step 3: Publishing to npm...');
    const filteredArgs = publishArgs.filter(arg => !arg.startsWith('--skip-increment'));
    const npmPublishArgs = ['publish', '--access=public', ...filteredArgs];
    await execCommand('npm', npmPublishArgs);
    
    console.log('\n🎉 Publish completed successfully!');
    if (!publishArgs.includes('--dry-run')) {
      console.log('📦 Package has been published with incremented version');
    } else {
      console.log('📦 Dry-run completed - no actual publish occurred');
    }
    
  } catch (error) {
    console.error('\n❌ Publish failed:', error.message);
    
    // Check if it's an authentication issue asking for browser auth
    if (error.message.includes('Authenticate your account') || error.message.includes('Press ENTER to open')) {
      console.error('\n🔧 Authentication issue detected!');
      console.error('💡 Your token might not have the right permissions or npm is requesting browser auth.');
      console.error('💡 Try running: npm run publish -- --skip-increment');
      console.error('   This will skip version increment and retry publishing with current version.');
    } else {
      console.error('\n💡 To fix this:');
      console.error('1. Check your npm authentication with: npm whoami');
      console.error('2. Verify NPM_TOKEN is set: echo $env:NPM_TOKEN');
      console.error('3. Ensure auth token is configured: npm config get //registry.npmjs.org/:_authToken');
      console.error('4. Verify your package.json is valid');
      console.error('5. Ensure all tests pass');
      console.error('6. If retrying after auth issues: npm run publish -- --skip-increment');
    }
    process.exit(1);
  } finally {
    // Clear the recursion flag
    delete process.env.PUBLISHING_IN_PROGRESS;
  }
}

// Run the script
main();