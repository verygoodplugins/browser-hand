/**
 * I/O for autofill data + keychain secrets. Kept separate from autofill.js
 * (pure substitution) so substitution stays pure and testable.
 *
 * Tier 2 (convenience profile): plain JSON at ~/.autohub/autofill.json.
 * Tier 3 (secure profile): macOS keychain via `security` CLI, service
 *   autohub-profile-<key>. Use for legal names, addresses, billing identity,
 *   SSN, card data, passwords, and other profile details that should not live
 *   in repo files/memory.
 * Tier 4 (secrets): macOS keychain via `security` CLI — values are fetched
 *   by the wrapper and substituted into vars just before stdin write, so the
 *   LLM never sees them.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { ContextLogger } from './logger.js';

const cl = new ContextLogger('autofill-io');

const KEYCHAIN_SERVICE_PREFIX = 'autohub-autofill-';
const PROFILE_SERVICE_PREFIX = 'autohub-profile-';

export function loadAutofillFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      cl.warn('autofill file is not a JSON object', { path: filePath });
      return {};
    }
    return parsed;
  } catch (err) {
    cl.warn('autofill file load failed', {
      path: filePath,
      error: err.message,
    });
    return {};
  }
}

/**
 * Read a secret from the macOS keychain.
 * Returns the secret value (newline-stripped) or null if not present / on error.
 *
 * Storage one-time setup (user runs this manually):
 *   security add-generic-password -s autohub-autofill-<key> -a "$USER" -w 'VALUE'
 */
export async function readKeychainSecret(key) {
  return await readGenericPassword({
    key,
    servicePrefix: KEYCHAIN_SERVICE_PREFIX,
    logLabel: 'keychain',
  });
}

/**
 * Read a secure profile value from the macOS keychain.
 *
 * Storage one-time setup (user runs this manually):
 *   security add-generic-password -s autohub-profile-<key> -a "$USER" -w 'VALUE'
 */
export async function readProfileSecret(key) {
  return await readGenericPassword({
    key,
    servicePrefix: PROFILE_SERVICE_PREFIX,
    logLabel: 'secure profile',
  });
}

async function readGenericPassword({ key, servicePrefix, logLabel }) {
  if (!key || typeof key !== 'string') {
    return null;
  }
  return await new Promise(resolve => {
    let proc;
    try {
      proc = spawn(
        'security',
        ['find-generic-password', '-s', `${servicePrefix}${key}`, '-w'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      cl.warn(`${logLabel} read failed`, { key, error: err.message });
      resolve(null);
      return;
    }

    let stdout = '';
    let settled = false;
    function finish(value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // already stopped
      }
      finish(null);
    }, 5000);

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    proc.on('error', err => {
      cl.warn(`${logLabel} read failed`, { key, error: err.message });
      finish(null);
    });
    proc.on('close', code => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const out = stdout.replace(/\r?\n$/, '');
      finish(out.length > 0 ? out : null);
    });
  });
}
