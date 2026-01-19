// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add .js extension resolution for ESM packages like @noble/*
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

// Ensure Metro resolves .js extensions in imports
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Handle @noble packages which use explicit .js extensions in exports
  if (moduleName.startsWith('@noble/')) {
    // If the import already has .js, let it resolve normally
    if (moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName, platform);
    }
  }
  
  // Default resolution
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
