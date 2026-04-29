#!/usr/bin/env node

import https from 'https';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { cwd } from 'process';
import { join } from 'path';

/*
const project_dir = process.env.CLAUDE_PROJECT_DIR;
let envFromSettings = {};
try {
  let settingsPath = ''
  if (project_dir) {
    settingsPath = join(project_dir, '.claude', 'settings.json');
  }
  if (!existsSync(settingsPath)) {
    settingsPath = join(homedir(), '.claude', 'settings.json');
  }
  if (existsSync(settingsPath)) {
    const settingsContent = readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(settingsContent);
    if (settings.env && typeof settings.env === 'object') {
      envFromSettings = settings.env;
    }
    Object.assign(process.env, envFromSettings);
  }
} catch (e) {}
*/

const DISPLAY_MODE = 'CNY'  // 'CNY' or 'USD' or 'ALL'
const CACHE_TTL = 60;
const cacheFile = join(tmpdir(), 'claude-deepseek-balance-cache');
const cacheTimeFile = join(tmpdir(), 'claude-deepseek-balance-cache-time');


const YELLOW = '\x1b[33m', RED = '\x1b[31m', RESET = '\x1b[0m';

const withColor = (balance, msg) => {
  if (balance < 5) {
    return `${RED}${msg}${RESET}`;
  } else if (balance < 10) { 
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

const queryBalance = (apiUrl, apiKey) => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(apiUrl);
    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : 443,
      path: `${parsedUrl.pathname}${parsedUrl.search || ''}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader
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
          resolve(json);
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
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com').trim();
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
  const model = (modelName || process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro').trim().toUpperCase();

  let balanceUrl = '';
  try {
    balanceUrl = new URL('/user/balance', baseUrl).toString();
  } catch (e) {
    return '';
  }

  if (!apiKey) {
    console.error('Error: DEEPSEEK_API_KEY or DEEPSEEK_AUTH_TOKEN is not set');
    process.exit(1);
  }

  try {
    const balanceData = await queryBalance(balanceUrl, apiKey);
    if (balanceData && Array.isArray(balanceData.balance_infos)) {
      const cny = balanceData.balance_infos.find(b => b.currency === 'CNY');
      const usd = balanceData.balance_infos.find(b => b.currency === 'USD');
      const cnyBalance = cny ? cny.total_balance : '0.00';
      const usdBalance = usd ? usd.total_balance : '0.00';
      const availability = balanceData.is_available ? 'available' : 'unavailable';
      let output = DISPLAY_MODE === 'ALL' ? `${model} | ${availability} | ${withColor(cnyBalance, `CNY ${cnyBalance}`)}  | ${withColor(usdBalance, `USD ${usdBalance}`)}` : 
        DISPLAY_MODE === 'CNY' ? `${model} | ${availability} | ${withColor(cnyBalance, `CNY ${cnyBalance}`)}` : 
        `${model} | ${availability} | ${withColor(cnyBalance, `CNY ${cnyBalance}`)}  | ${withColor(usdBalance, `USD ${usdBalance}`)}`;
      writeCache(output);
      return output;
    }
    return 'Invalid response';
  } catch (error) {
    // string error message and max length 50 characters
    return error.message.slice(0, 50);
  }
};

/*
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    let data = {};
    try {
      data = input ? JSON.parse(input) : {};
    } catch (e) {
      data = {};
    }
    const model = data?.model?.display_name || '';
    const context_usage = data?.context_window?.used_percentage || 0;
    const session_id = data.session_id || '';
    const ctx_output = withColor(context_usage, `${context_usage}% used`);
    run(model).then(glm_output => {
        console.log(`${glm_output} | ctx ${ctx_output} | ${session_id}`);
    }).catch(() => {
        console.log(`${model} | ctx ${ctx_output} | ${session_id}`);
    });
});
*/

run("deepseek-v4-pro").then(output => console.log(output)).catch(() => console.log(''));


/*
Usage:
- Copy this file into ~/.claude/scripts/ (create the folder if not existing)
- Add settings below into ~/.claude/settings.json

  "env": {
    "DEEPSEEK_API_KEY": "sk-xxxxxx"
  },

  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/scripts/query-usage-lite.mjs"
  },
*/
