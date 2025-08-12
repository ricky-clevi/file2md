#!/usr/bin/env node

/**
 * Automatic version increment script for npm publish
 * 
 * This script:
 * 1. Increments the patch version in the root package.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to package.json files
const rootPackagePath = path.join(__dirname, '..', 'package.json');

/**
 * Increment the patch version (x.y.z -> x.y.(z+1))
 */
function incrementPatchVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  const [major, minor, patch] = parts.map(Number);
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Update package.json file with new version
 */
function updatePackageVersion(packagePath, newVersion, dependencyUpdate = null) {
  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageData = JSON.parse(packageContent);
    
    if (dependencyUpdate) {
      // Update dependency version
      if (packageData.dependencies && packageData.dependencies[dependencyUpdate.name]) {
        packageData.dependencies[dependencyUpdate.name] = `^${dependencyUpdate.version}`;
        console.log(`📦 Updated ${dependencyUpdate.name} dependency to ^${dependencyUpdate.version} in ${path.basename(packagePath)}`);
      }
    } else {
      // Update package version
      const oldVersion = packageData.version;
      packageData.version = newVersion;
      console.log(`🔄 Updated version from ${oldVersion} to ${newVersion} in ${path.basename(packagePath)}`);
    }
    
    // Write back with proper formatting
    const updatedContent = JSON.stringify(packageData, null, 2) + '\n';
    fs.writeFileSync(packagePath, updatedContent, 'utf8');
    
    return packageData.version;
  } catch (error) {
    console.error(`❌ Failed to update ${packagePath}:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Starting automatic version increment...');
    
    // Check if package.json files exist
    if (!fs.existsSync(rootPackagePath)) {
      throw new Error(`Root package.json not found at: ${rootPackagePath}`);
    }
    
    // Read current root package version
    const rootPackageContent = fs.readFileSync(rootPackagePath, 'utf8');
    const rootPackageData = JSON.parse(rootPackageContent);
    const currentVersion = rootPackageData.version;
    
    console.log(`📋 Current version: ${currentVersion}`);
    
    // Increment patch version
    const newVersion = incrementPatchVersion(currentVersion);
    console.log(`📋 New version: ${newVersion}`);
    
    // Update root package.json
    updatePackageVersion(rootPackagePath, newVersion);
    
    console.log('✅ Version increment completed successfully!');
    console.log(`📦 Root package: ${currentVersion} → ${newVersion}`);
    
  } catch (error) {
    console.error('❌ Version increment failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();