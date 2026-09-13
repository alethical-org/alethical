const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The pinned @expo/metro-config patch keeps shared modules with their lazy
// screens in production web exports. Development and native builds keep Expo's
// default behavior. Issue: https://github.com/alethical-org/alethical/issues/2012
config.serializer.alethicalKeepSharedWithScreens = true;

module.exports = config;
