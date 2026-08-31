#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const PRIVATE_AUTH_FIELDS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'id_token',
  'token_hash',
  'token',
  'code',
  'code_verifier',
  'state',
  'nonce',
  'otp',
  'device_code',
  'user_code',
  'session_state',
]);

const PRIVATE_AUTH_FIELD_WORD = /(^|[_-])(token|secret|code|verifier|state|nonce|otp)([_-]|$)/u;
const AUTH_CALLBACK_PROTOCOLS = new Set(['http:', 'https:', 'alethical:']);

function decodedFieldName(rawFieldName) {
  try {
    return { name: decodeURIComponent(rawFieldName).toLowerCase(), failed: false };
  } catch {
    return { name: rawFieldName.toLowerCase(), failed: true };
  }
}

function privateFieldPresent(rawParameters) {
  if (!rawParameters) return false;

  return rawParameters.split(/[?&;]/u).some((part) => {
    const rawFieldName = part.split('=', 1)[0];
    if (!rawFieldName) return false;

    const { name, failed } = decodedFieldName(rawFieldName);
    return failed || PRIVATE_AUTH_FIELDS.has(name) || PRIVATE_AUTH_FIELD_WORD.test(name);
  });
}

/**
 * Return the only sign-in callback details that may enter logs or task output.
 * The query and fragment are inspected in memory and are never copied to the result.
 */
export function safeAuthCallbackReport(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error('Could not report the sign-in return address safely.');
  }
  if (!AUTH_CALLBACK_PROTOCOLS.has(url.protocol)) {
    throw new Error('Could not report the sign-in return address safely.');
  }

  return {
    origin: url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin,
    path: url.pathname,
    privateQueryFieldsPresent: privateFieldPresent(url.search.slice(1)),
    privateFragmentFieldsPresent: privateFieldPresent(url.hash.slice(1)),
  };
}

async function readStandardInput() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = safeAuthCallbackReport(await readStandardInput());
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.stderr.write('Could not report the sign-in return address safely.\n');
    process.exitCode = 1;
  }
}
