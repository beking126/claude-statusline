#!/usr/bin/env node

import https from 'https';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

let envFromSettings = {};
try {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settingsContent = readFileSync(settingsPath, 'utf8');
  const settings = JSON.parse(settingsContent);
  if (settings.env && typeof settings.env === 'object') {
    envFromSettings = settings.env;
  }
  Object.assign(process.env, envFromSettings);
} catch (e) {}

const CACHE_TTL = 300;
const cacheFile = join(tmpdir(), 'claude-usage-cache');
const cacheTimeFile = join(tmpdir(), 'claude-usage-cache-time');


const CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m';

const withColor = (pct, msg) => {
  if (pct >= 90) {
    return `${RED}${msg}${RESET}`;
  } else if (pct >= 60) {
    return `${YELLOW}${msg}${RESET}`;
  } else {
    return msg;
  }
}

const readCache = () => {
  try {
    const now = Math.floor(Date.now() / 1000);
    if (!existsSync(cacheTimeFile)) return null;
    const cacheTime = parseInt(readFileSync(cacheTimeFile, 'utf8').trim(), 10);
    if (isNaN(cacheTime) || (now - cacheTime) >= CACHE_TTL) return null;
    if (!existsSync(cacheFile)) return null;
    return readFileSync(cacheFile, 'utf8').trim();
  } catch (e) {
    return null;
  }
};

const writeCache = (content) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(cacheFile, content, 'utf8');
    writeFileSync(cacheTimeFile, String(now), 'utf8');
  } catch (e) {}
};

const queryUsage = (apiUrl, authToken) => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(apiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname,
      method: 'GET',
      headers: {
        'Authorization': authToken,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json.data || json);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

const run = async (modelName) => {
  const cached = readCache();
  if (cached !== null) {
    if (cached) return cached;
  }
  const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
  const model = modelName || (process.env.ANTHROPIC_MODEL || '').trim().toUpperCase();

  const parsedBaseUrl = new URL(baseUrl);
  const baseDomain = `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}`;
  const quotaLimitUrl = `${baseDomain}/api/monitor/usage/quota/limit`;

  if (!authToken) {
    console.error('Error: ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  if (!baseUrl) {
    console.error('Error: ANTHROPIC_BASE_URL is not set');
    process.exit(1);
  }

  try {
    const quotaData = await queryUsage(quotaLimitUrl, authToken);
    const level = (quotaData.level || 'Free').toUpperCase();
    if (quotaData && quotaData.limits) {
      const tokenLimit = quotaData.limits.find(l => l.type === 'TOKENS_LIMIT');
      if (tokenLimit) {
        const resetDate = new Date(tokenLimit.nextResetTime);
        const nextResetTime = resetDate.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit'
        });
        const pct = tokenLimit.percentage;
        const output = `${level} | ${model} | ${withColor(pct, `${pct}% used`)} | reset at ${nextResetTime}`;
        // console.log(output);
        writeCache(output);
        return output;
      }
    }
    // console.log('');
    return '';
  } catch (error) {
    // console.log('');
    return '';
  }
};

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const data = JSON.parse(input);
    const model = data.model.display_name || '';
    const context_usage = data.context_window.used_percentage || 0;
    const ctx_output = withColor(context_usage, `${context_usage}% used`);
    run(model).then(glm_output => {
        console.log(`${glm_output} | ctx ${ctx_output}`);
    }).catch(() => {
        console.log(`${model} | ctx ${ctx_output}`);
    });
});

// run().catch(() => console.log(''));


/*
Usage:
- Copy this file into ~/.claude/scripts/ (create the folder if not existing)
- Add settings below into ~/.claude/settings.json

  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/query-usage-lite.mjs"
  },
*/