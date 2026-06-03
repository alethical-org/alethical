import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, '..');
const androidMain = resolve(frontendRoot, 'android', 'app', 'src', 'main');
const manifestPath = resolve(androidMain, 'AndroidManifest.xml');
const xmlDir = resolve(androidMain, 'res', 'xml');
const networkSecurityConfigPath = resolve(xmlDir, 'network_security_config.xml');

if (!existsSync(manifestPath)) {
  throw new Error(
    `Android project is missing at ${manifestPath}. Run "pnpm --dir apps/frontend exec expo prebuild --platform android" first.`
  );
}

mkdirSync(xmlDir, { recursive: true });

writeFileSync(
  networkSecurityConfigPath,
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`,
  'utf8'
);

const manifest = readFileSync(manifestPath, 'utf8');
const applicationTagPattern = /<application\b([^>]*)>/;
const applicationTagMatch = manifest.match(applicationTagPattern);

if (!applicationTagMatch) {
  throw new Error(`Could not find <application> tag in ${manifestPath}`);
}

let applicationAttrs = applicationTagMatch[1];

applicationAttrs = applicationAttrs
  .replace(/\sandroid:usesCleartextTraffic="[^"]*"/g, '')
  .replace(/\sandroid:networkSecurityConfig="[^"]*"/g, '');

const updatedApplicationTag = `<application${applicationAttrs} android:networkSecurityConfig="@xml/network_security_config">`;
const updatedManifest = manifest.replace(applicationTagPattern, updatedApplicationTag);

writeFileSync(manifestPath, updatedManifest, 'utf8');

console.log(`Synced Android local network security config: ${networkSecurityConfigPath}`);
