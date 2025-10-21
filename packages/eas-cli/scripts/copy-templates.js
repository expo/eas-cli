#!/usr/bin/env node

/**
 * Cross-platform script to copy template files from src to build directory.
 * Replaces the Unix-only "cp -r" and "mkdir -p" commands.
 */

const fs = require('fs-extra');
const path = require('path');

const buildTemplatesDir = path.join(__dirname, '..', 'build', 'commandUtils', 'new', 'templates');
const srcTemplatesDir = path.join(__dirname, '..', 'src', 'commandUtils', 'new', 'templates');

async function copyTemplates() {
  try {
    // Remove existing build/commandUtils/new/templates if it exists
    await fs.remove(buildTemplatesDir);

    // Copy src/commandUtils/new/templates to build/commandUtils/new/templates
    await fs.copy(srcTemplatesDir, buildTemplatesDir);

    console.log('✓ Templates copied successfully');
  } catch (error) {
    console.error('Error copying templates:', error);
    process.exit(1);
  }
}

copyTemplates();
