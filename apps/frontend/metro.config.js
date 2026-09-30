const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The pinned @expo/metro-config patch keeps shared modules with their lazy
// screens in production web exports. Development and native builds keep Expo's
// default behavior. Issue: https://github.com/alethical-org/alethical/issues/2012
config.serializer.alethicalKeepSharedWithScreens = true;

// Review fixtures must not exist in exported website files, even as unused chunks.
const defaultResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    !context.dev &&
    /\/(?:screens\/CandidatePreviewScreens|dev\/candidatePreview)$/.test(moduleName)
  ) {
    return { type: 'empty' };
  }
  return defaultResolver
    ? defaultResolver(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
