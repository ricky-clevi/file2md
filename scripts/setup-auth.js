#!/usr/bin/env node

/**
 * NPM Authentication Setup Helper
 * 
 * This script helps verify and configure NPM authentication using tokens
 */

import { spawn } from 'node:child_process';

/**
 * Execute a command and return output
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      ...options
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  console.log('🔐 NPM Authentication Setup Helper\n');
  
  try {
    // Check if NPM_TOKEN is set
    console.log('1. Checking NPM_TOKEN environment variable...');
    if (process.env.NPM_TOKEN) {
      console.log('✅ NPM_TOKEN is set');
      console.log(`   Token: ${process.env.NPM_TOKEN.substring(0, 8)}...`);
    } else {
      console.log('❌ NPM_TOKEN is not set');
      console.log('💡 Set it with: export NPM_TOKEN=your-npm-token');
    }
    
    // Check npm configuration
    console.log('\n2. Checking npm auth token configuration...');
    try {
      const authToken = await execCommand('npm', ['config', 'get', '//registry.npmjs.org/:_authToken']);
      if (authToken && authToken !== 'undefined') {
        console.log('✅ npm auth token is configured');
        console.log(`   Token: ${authToken.substring(0, 8)}...`);
      } else {
        console.log('❌ npm auth token is not configured');
        console.log('💡 Set it with: npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN');
      }
    } catch (error) {
      console.log('❌ Failed to check npm auth token configuration');
      console.log('💡 Set it with: npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN');
    }
    
    // Check npm authentication
    console.log('\n3. Testing npm authentication...');
    try {
      const user = await execCommand('npm', ['whoami']);
      console.log(`✅ npm authentication successful`);
      console.log(`   Logged in as: ${user}`);
    } catch (error) {
      console.log('❌ npm authentication failed');
      console.log('💡 Make sure your token is valid and properly configured');
    }
    
    // Check package permissions
    console.log('\n4. Checking package publish permissions...');
    try {
      const packageName = 'file2md';
      await execCommand('npm', ['access', 'ls-packages']);
      console.log(`✅ Can access npm packages`);
      
      // Check specific package access
      try {
        await execCommand('npm', ['owner', 'ls', packageName]);
        console.log(`✅ Have access to package: ${packageName}`);
      } catch (ownerError) {
        console.log(`⚠️  Cannot verify access to package: ${packageName}`);
        console.log('   This is normal for first-time publishing');
      }
    } catch (error) {
      console.log('⚠️  Cannot check package permissions');
      console.log('   This might be normal depending on your npm access level');
    }
    
    console.log('\n🎉 Authentication setup check completed!');
    
    if (process.env.NPM_TOKEN) {
      console.log('\n💡 You can now use:');
      console.log('   npm run publish        # Publish with version increment');
      console.log('   npm run publish:dry    # Test publish without actually publishing');
    } else {
      console.log('\n⚠️  To complete setup:');
      console.log('1. Get your npm token from https://www.npmjs.com/settings/tokens');
      console.log('2. Export it: export NPM_TOKEN=your-token');
      console.log('3. Configure npm: npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN');
      console.log('4. Run this script again to verify');
    }
    
  } catch (error) {
    console.error('❌ Setup check failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();