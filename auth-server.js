/**
 * auth-server-prod.js — 生产环境认证 + 反向代理服务
 * 端口：19000（绑定 0.0.0.0，局域网可访问）
 *
 * 路由：
 *   POST /login          — 用户名/密码登录，返回 JWT（7天有效）
 *   GET  /static/*       — 托管 canvas-prod/ 目录静态文件（无需认证）
 *   ANY  /gw/*           — 验证 JWT 后代理到 Gateway :18789（HTTP + SSE 流式）
 *
 * WS 代理：暂不实现。
 *   原因：Node 原生 http.Server 的 'upgrade' 事件可处理 WS，但需要手动拼帧，
 *   建议后续引入 'ws' 或 'http-proxy' 包实现。如需 WS，可监听 server.on('upgrade')
 *   并 pipe socket 到 Gateway。
 */

'use strict';

const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { promisify } = require('util');
const jwt     = require('jsonwebtoken');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const net = require('net');
const { getUser, createUser, hasAnyUser, listUsers, updateUserRole, updateUserPassword, deleteUser } = require('./db-auth-prod');

// ── 配置 ──────────────────────────────────────────────────────────────────
const PORT           = 19000;
const BIND_HOST      = '0.0.0.0';  // 局域网可访问
const GW_HOST        = '127.0.0.1';
const GW_TOKEN       = '92c4939d7d2423b16bef53630b42d7b48b06392f814fd1bb';
const CANVAS_DIR     = path.join(__dirname, '..', 'canvas-prod');
const WORKSPACE_ROOT = 'C:\\Users\\Win10\\.openclaw\\workspace-prod\\users';
const TEMPLATE_DIR   = 'C:\\Users\\Win10\\.openclaw\\workspace-prod\\template';
const OPENCLAW_BIN   = 'C:\\Users\\Win10\\AppData\\Roaming\\npm\\node_modules\\openclaw\\openclaw.mjs';
const JWT_SECRET     = process.env.JWT_SECRET || 'openclaw-auth-secret-change-me';
const JWT_EXPIRES    = '7d';
const SALT_LEN       = 32;   // bytes
const SCRYPT_N       = 16384;
const SCRYPT_r       = 8;
const SCRYPT_p     = 1;
const KEY_LEN      = 64;   // bytes

const scrypt = promisify(crypto.scrypt);

// ── MIME ──────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

// ── 密码工具 ──────────────────────────────────────────────────────────────
async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const key  = await scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return salt + ':' + key.toString('hex');
}

async function verifyPassword(password, storedCombined) {
  const sep = storedCombined.indexOf(':');
  if (sep === -1) return false;
  const salt       = storedCombined.slice(0, sep);
  const storedHash = storedCombined.slice(sep + 1);
  const key = await scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  const a = Buffer.from(key.toString('hex'));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── 响应工具 ──────────────────────────────────────────────────────────────
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── JWT 验证中间件 ─────────────────────────────────────────────────────────
function verifyJWT(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── 读取请求 body ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Gateway 进程管理 ──────────────────────────────────────────────────────
const gwProcesses = {};

function startGateway(username, port) {
  if (gwProcesses[username]?.proc && !gwProcesses[username].proc.killed) {
    console.log(`[gw] ${username} already running on :${port}`);
    return;
  }
  const userDir = path.join(WORKSPACE_ROOT, username);
  const configPath = path.join(userDir, 'openclaw.json');
  try { fs.writeFileSync(path.join(userDir, 'USER_ID'), username, 'utf8'); } catch(e) {}

  const proc = spawn('node', [
    OPENCLAW_BIN, 'gateway',
    '--port', String(port),
    '--token', GW_TOKEN,
    '--allow-unconfigured',
  ], {
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_AGENT_DIR: path.join(userDir, 'agents'),
      OPENCLAW_STATE_DIR: path.join(userDir, '.openclaw'),
    },
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => console.log(`[gw:${username}] ${d.toString().trim()}`));
  proc.stderr.on('data', d => console.error(`[gw:${username}:err] ${d.toString().trim()}`));
  proc.on('exit', (code, sig) => {
    console.log(`[gw:${username}] exited code=${code} sig=${sig}`);
    if (gwProcesses[username]?.proc === proc) gwProcesses[username].proc = null;
    if (sig !== 'SIGTERM') {
      setTimeout(() => { if (!gwProcesses[username]?.proc) startGateway(username, port); }, 5000);
    }
  });

  gwProcesses[username] = { proc, port, pid: proc.pid };
  console.log(`[gw] started ${username} on :${port} pid=${proc.pid}`);
}

function stopGateway(username) {
  const entry = gwProcesses[username];
  if (!entry?.proc || entry.proc.killed) return;
  entry.proc.kill('SIGTERM');
  gwProcesses[username].proc = null;
}

function checkPortOpen(port) {
  return new Promise(resolve => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    let done = false;
    const finish = v => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.on('connect', () => finish(true));
    sock.on('error',   () => finish(false));
    setTimeout(() => finish(false), 500);
  });
}

const _gwAliveCache = {}; // port -> ts
async function isGatewayAlive(port) {
  const now = Date.now();
  if (_gwAliveCache[port] && (now - _gwAliveCache[port]) < 5000) return true;
  const open = await checkPortOpen(port);
  if (open) _gwAliveCache[port] = now;
  else delete _gwAliveCache[port];
  return open;
}

// ── 用户 workspace 初始化 ─────────────────────────────────────────────────
function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function initUserWorkspace(username) {
  const userDir = path.join(WORKSPACE_ROOT, username);
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(path.join(userDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(userDir, 'files'), { recursive: true });

  if (fs.existsSync(TEMPLATE_DIR)) {
    try { copyDirSync(TEMPLATE_DIR, userDir); } catch(e) { console.warn(`[init] template copy failed: ${e.message}`); }
  }

  const configPath = path.join(userDir, 'openclaw.json');
  if (!fs.existsSync(configPath)) {
    const config = {
      gateway: { mode: 'local', bind: 'loopback' },
      agents: { defaults: { workspace: userDir } },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  const ensureFiles = {
    'HEARTBEAT.md': '# HEARTBEAT.md\n\n',
    'USER.md': '# USER.md - About Your Human\n\n- **Name:**\n- **Timezone:**\n- **Notes:**\n',
    'IDENTITY.md': '# IDENTITY.md - 凌霄\n\n- **名字：** 凌霄\n- **角色：** 主 Agent\n- **Emoji：** 🌤️\n',
  };
  for (const [fname, content] of Object.entries(ensureFiles)) {
    const fpath = path.join(userDir, fname);
    if (!fs.existsSync(fpath)) fs.writeFileSync(fpath, content, 'utf8');
  }
  console.log(`[init] workspace ready for ${username}`);
}

// ── 代理到 file-server（/api/kv、/api/files、/api/avatar、/upload 等）─────────
const FILE_SERVER_HOST = '127.0.0.1';
const FILE_SERVER_PORT = 18790;

function proxyToFileServer(req, res, targetPath, bodyBuf) {
  const headers = Object.assign({}, req.headers);
  delete headers['host'];
  delete headers['connection'];
  delete headers['transfer-encoding'];
  if (bodyBuf !== undefined && bodyBuf.length > 0) {
    headers['content-length'] = String(bodyBuf.length);
  }

  const options = {
    hostname: FILE_SERVER_HOST,
    port:     FILE_SERVER_PORT,
    path:     targetPath,
    method:   req.method,
    headers,
  };

  const proxyReq = http.request(options, proxyRes => {
    const resHeaders = Object.assign({}, proxyRes.headers);
    delete resHeaders['transfer-encoding'];
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      resHeaders['content-length'] = String(body.length);
      res.writeHead(proxyRes.statusCode, resHeaders);
      res.end(body);
    });
    proxyRes.on('error', err => {
      console.error('[file-proxy] proxyRes error:', err.message);
      if (!res.headersSent) json(res, 502, { error: 'File server error' });
      else if (!res.writableEnded) res.end();
    });
  });

  proxyReq.on('error', err => {
    console.error('[file-proxy] proxyReq error:', err.message);
    if (!res.headersSent) json(res, 502, { error: 'File server unreachable' });
    else if (!res.writableEnded) res.end();
  });

  if (bodyBuf && bodyBuf.length > 0) proxyReq.write(bodyBuf);
  proxyReq.end();
}

// ── 代理到 Gateway（HTTP + SSE 流式）────────────────────────────────────────
function proxyToGateway(req, res, gwPort, targetPath, bodyBuf) {
  const isSSE = (req.headers['accept'] || '').includes('text/event-stream');

  const headers = Object.assign({}, req.headers);
  delete headers['host'];
  delete headers['connection'];
  delete headers['transfer-encoding'];
  headers['authorization'] = `Bearer ${GW_TOKEN}`;
  if (bodyBuf !== undefined && bodyBuf.length > 0) {
    headers['content-length'] = String(bodyBuf.length);
  }

  const options = {
    hostname: GW_HOST,
    port:     gwPort,
    path:     targetPath,
    method:   req.method,
    headers,
  };

  const proxyReq = http.request(options, proxyRes => {
    const resHeaders = Object.assign({}, proxyRes.headers);
    delete resHeaders['transfer-encoding'];

    if (isSSE) {
      resHeaders['cache-control'] = 'no-cache';
      resHeaders['x-accel-buffering'] = 'no';
      res.writeHead(proxyRes.statusCode, resHeaders);
      proxyRes.on('data', chunk => {
        if (!res.writableEnded) res.write(chunk);
      });
      proxyRes.on('end', () => {
        if (!res.writableEnded) res.end();
      });
    } else {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        resHeaders['content-length'] = String(body.length);
        res.writeHead(proxyRes.statusCode, resHeaders);
        res.end(body);
      });
    }

    proxyRes.on('error', err => {
      console.error('[proxy] proxyRes error:', err.message);
      if (!res.headersSent) json(res, 502, { error: 'Gateway error' });
      else if (!res.writableEnded) res.end();
    });
  });

  proxyReq.on('error', err => {
    console.error('[proxy] proxyReq error:', err.message);
    if (!res.headersSent) json(res, 502, { error: 'Gateway unreachable' });
    else if (!res.writableEnded) res.end();
  });

  if (bodyBuf && bodyBuf.length > 0) proxyReq.write(bodyBuf);
  proxyReq.end();
}

// ── 主请求处理 ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── POST /login ────────────────────────────────────────────────────────
  if (pathname === '/login' && req.method === 'POST') {
    let body;
    try {
      const buf = await readBody(req);
      body = JSON.parse(buf.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }

    const { username, password } = body || {};
    if (!username || !password) {
      return json(res, 400, { error: 'username and password required' });
    }

    const user = getUser(username);
    if (!user) {
      return json(res, 401, { error: 'Invalid credentials' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return json(res, 401, { error: 'Invalid credentials' });
    }

    const token = jwt.sign({ sub: username, role: user.role || 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return json(res, 200, { token });
  }

  // ── /files/* — 代理到 file-server(:18790)，文件下载 ─────────────────────
  if (pathname.startsWith('/files/')) {
    const target = http.request({
      hostname: '127.0.0.1', port: FILE_SERVER_PORT,
      path: req.url,
      method: req.method,
      headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + FILE_SERVER_PORT }),
    }, (proxyRes) => {
      const h = Object.assign({}, proxyRes.headers);
      delete h['transfer-encoding'];
      res.writeHead(proxyRes.statusCode, h);
      proxyRes.pipe(res);
    });
    target.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('file-server unavailable'); } });
    req.pipe(target);
    return;
  }

  // ── /upload/* — 转发给 file-server（需要登录）────────────────────────────
  if (pathname.startsWith('/upload/') || pathname === '/upload') {
    const payload = verifyJWT(req);
    if (!payload) return json(res, 401, { error: 'Unauthorized' });
    const bodyBuf = await readBody(req);
    const targetPath = pathname + (url.search || '');
    return proxyToFileServer(req, res, targetPath, bodyBuf);
  }

  // ── /api/* — 路由分流 ─────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const payload = verifyJWT(req);
    if (!payload) return json(res, 401, { error: 'Unauthorized' });

    // kv / files / avatar / convert → 转发给 file-server
    if (
      pathname.startsWith('/api/kv') ||
      pathname.startsWith('/api/files') ||
      pathname.startsWith('/api/avatar') ||
      pathname.startsWith('/api/convert') ||
      pathname === '/api/sessions'
    ) {
      const bodyBuf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        ? await readBody(req)
        : Buffer.alloc(0);
      const targetPath = pathname + (url.search || '');
      return proxyToFileServer(req, res, targetPath, bodyBuf);
    }

    // ── GET /api/skills — 所有登录用户可访问 ────────────────────────────────
    if (pathname === '/api/skills' && req.method === 'GET') {
      const GLOBAL_SKILLS_DIR = path.join(
        process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
        'npm', 'node_modules', 'openclaw', 'skills'
      );
      const USER_SKILLS_DIR = path.join(__dirname, '..', 'skills');
      function parseFrontmatter(text) {
        const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!m) return {};
        const block = m[1]; const result = {}; let currentKey = null;
        for (const line of block.split('\n')) {
          const kv = line.match(/^(\w+):\s*(.*)/);
          if (kv) {
            currentKey = kv[1]; let val = kv[2].trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            result[currentKey] = val;
          } else if (currentKey && line.startsWith('  ')) {
            result[currentKey] = (result[currentKey] || '') + ' ' + line.trim();
          } else { currentKey = null; }
        }
        return result;
      }
      function readSkillsDir(dir, source) {
        const skills = [];
        if (!fs.existsSync(dir)) return skills;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillMd = path.join(dir, entry.name, 'SKILL.md');
          if (!fs.existsSync(skillMd)) continue;
          try {
            const text = fs.readFileSync(skillMd, 'utf8');
            const fm = parseFrontmatter(text);
            const headingMatch = text.match(/^#\s+(.+)$/m);
            const name = fm.name || (headingMatch ? headingMatch[1].trim() : entry.name);
            skills.push({ slug: entry.name, name, description: fm.description || '', source });
          } catch (_) {}
        }
        return skills;
      }
      const builtinSkills = readSkillsDir(GLOBAL_SKILLS_DIR, 'builtin');
      const userSkills    = readSkillsDir(USER_SKILLS_DIR,   'user');
      const merged = [...builtinSkills];
      for (const us of userSkills) {
        const idx = merged.findIndex(s => s.slug === us.slug);
        if (idx >= 0) merged[idx] = us; else merged.push(us);
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { skills: merged });
    }

    // ── GET /api/clawhub/search — 代理 ClawHub 搜索（避免浏览器CORS）────────
    if (pathname === '/api/clawhub/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const limit = url.searchParams.get('limit') || '24';
      const https = require('https');
      function fetchClawHub(reqUrl, redirects) {
        if (redirects > 5) return json(res, 502, { error: 'Too many redirects' });
        const chReq = https.get(reqUrl, { headers: { 'User-Agent': 'openclaw-auth-server' } }, (chRes) => {
          if (chRes.statusCode >= 300 && chRes.statusCode < 400 && chRes.headers.location) {
            chRes.resume();
            return fetchClawHub(chRes.headers.location, redirects + 1);
          }
          const chunks = [];
          chRes.on('data', c => chunks.push(c));
          chRes.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(body);
          });
        });
        chReq.on('error', (e) => json(res, 502, { error: e.message }));
        chReq.end();
      }
      fetchClawHub(`https://clawhub.com/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, 0);
      return;
    }

    // ── GET /api/gateway/status — Gateway 状态查询 ──────────────────────
    if (pathname === '/api/gateway/status' && req.method === 'GET') {
      const username = payload.sub;
      const entry = gwProcesses[username];
      if (!entry?.port) return json(res, 200, { status: 'stopped', ready: false });
      const alive = await isGatewayAlive(entry.port);
      return json(res, 200, { status: alive ? 'running' : 'starting', ready: alive });
    }

    // ── GET /api/agents — agent 列表（所有登录用户可访问）──────────────────
    if (pathname === '/api/agents' && req.method === 'GET') {
      try {
        const cfgFile = path.join(WORKSPACE_ROOT, payload.sub, 'openclaw.json');
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        const list = (cfg.agents && cfg.agents.list) || [];
        const displayPath = path.join(WORKSPACE_ROOT, payload.sub, 'agent-display.json');
        let displayMap = {};
        if (fs.existsSync(displayPath)) {
          try { displayMap = JSON.parse(fs.readFileSync(displayPath, 'utf8')); } catch {}
        }
        const agents = list.map(a => {
          const disp = displayMap[a.id] || {};
          const obj = {
            id:    a.id,
            name:  (a.identity && a.identity.name) || a.name || a.id,
            emoji: (a.identity && a.identity.emoji) || '🤖',
          };
          if (disp.role !== undefined) obj.role = disp.role;
          if (disp.desc !== undefined) obj.desc = disp.desc;
          return obj;
        });
        return json(res, 200, { agents });
      } catch(e) {
        return json(res, 500, { error: e.message });
      }
    }

    // ── GET /api/config/get — 读取用户 openclaw.json ────────────────────────
    if (pathname === '/api/config/get' && req.method === 'GET') {
      try {
        const cfgPath = path.join(WORKSPACE_ROOT, payload.sub, 'openclaw.json');
        if (!fs.existsSync(cfgPath)) return json(res, 200, {});
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return json(res, 200, cfg);
      } catch(e) {
        return json(res, 500, { error: e.message });
      }
    }

    // ── POST /api/config/patch — 深合并写入用户 openclaw.json ───────────────
    if (pathname === '/api/config/patch' && req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const cfgPath = path.join(WORKSPACE_ROOT, payload.sub, 'openclaw.json');
        let current = {};
        if (fs.existsSync(cfgPath)) {
          try { current = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
        }
        function deepMerge(target, source) {
          for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
                target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
              deepMerge(target[key], source[key]);
            } else {
              target[key] = source[key];
            }
          }
          return target;
        }
        if (body.agents && Array.isArray(body.agents.list)) {
          const existingList = (current.agents && current.agents.list) || [];
          const patchedList = body.agents.list.map(a => {
            const clean = { id: a.id };
            const displayName = a.name || a.id;
            const emoji = a.emoji || (a.identity && a.identity.emoji) || '🤖';
            clean.name = displayName;
            clean.identity = { name: displayName, emoji };
            if (a.agentDir) clean.agentDir = a.agentDir;
            if (a.modelId) {
              const provider = a.providerId || 'default';
              clean.model = { primary: provider + '/' + a.modelId };
            }
            return clean;
          });
          const displayPath = path.join(WORKSPACE_ROOT, payload.sub, 'agent-display.json');
          let displayMap = {};
          if (fs.existsSync(displayPath)) {
            try { displayMap = JSON.parse(fs.readFileSync(displayPath, 'utf8')); } catch {}
          }
          body.agents.list.forEach(a => {
            if (a.role !== undefined || a.desc !== undefined) {
              if (!displayMap[a.id]) displayMap[a.id] = {};
              if (a.role !== undefined) displayMap[a.id].role = a.role;
              if (a.desc !== undefined) displayMap[a.id].desc = a.desc;
            }
          });
          fs.writeFileSync(displayPath, JSON.stringify(displayMap, null, 2), 'utf8');
          const merged = [...existingList];
          patchedList.forEach(pa => {
            const idx = merged.findIndex(e => e.id === pa.id);
            if (idx >= 0) merged[idx] = Object.assign({}, merged[idx], pa);
            else merged.push(pa);
          });
          body.agents.list = merged;
          const allIds = merged.map(a => a.id);
          if (!body.tools) body.tools = {};
          if (!body.tools.agentToAgent) body.tools.agentToAgent = {};
          body.tools.agentToAgent.allow = allIds;
        }
        const before = JSON.stringify(current);
        deepMerge(current, body);
        const after = JSON.stringify(current);
        if (before !== after) {
          const tmpPath = cfgPath + '.tmp';
          fs.writeFileSync(tmpPath, JSON.stringify(current, null, 2), 'utf8');
          fs.renameSync(tmpPath, cfgPath);

          // ── 热重载：同步 TEAM.md + 重启 Gateway ──
          const username = payload.sub;
          try {
            const { execFileSync } = require('child_process');
            execFileSync('node', [
              path.join(__dirname, '..', 'scripts', 'sync-team.js'),
              cfgPath
            ], { timeout: 5000 });
            console.log(`[hot-reload] TEAM.md synced for ${username}`);
          } catch (e) {
            console.error(`[hot-reload] sync-team failed: ${e.message}`);
          }
          const entry = gwProcesses[username];
          if (entry?.port) {
            console.log(`[hot-reload] restarting gateway for ${username}`);
            stopGateway(username);
            setTimeout(() => startGateway(username, entry.port), 2000);
          }
        }
        return json(res, 200, { ok: true, reloaded: before !== after });
      } catch(e) {
        return json(res, 500, { error: e.message });
      }
    }

    // 以下仅限 admin
    if (payload.role !== 'admin') return json(res, 403, { error: 'Forbidden: admin only' });

    if (pathname === '/api/users' && req.method === 'GET') {
      const users = listUsers().map(u => ({ username: u.username, role: u.role, created_at: u.created_at }));
      return json(res, 200, { users });
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const { username, password, role = 'user' } = body || {};
      if (!username || !password) return json(res, 400, { error: 'username and password required' });
      if (getUser(username)) return json(res, 409, { error: 'User already exists' });
      const combined = await hashPassword(password);
      createUser(username, combined, role);
      return json(res, 201, { ok: true, username });
    }

    const putMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (putMatch && req.method === 'PUT') {
      const target = decodeURIComponent(putMatch[1]);
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const { role, password } = body || {};
      if (!getUser(target)) return json(res, 404, { error: 'User not found' });
      if (role) updateUserRole(target, role);
      if (password) {
        const combined = await hashPassword(password);
        updateUserPassword(target, combined);
      }
      return json(res, 200, { ok: true });
    }

    const delMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (delMatch && req.method === 'DELETE') {
      const target = decodeURIComponent(delMatch[1]);
      if (target === payload.sub) return json(res, 400, { error: 'Cannot delete yourself' });
      if (!getUser(target)) return json(res, 404, { error: 'User not found' });
      deleteUser(target);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not Found' });
  }

  // ── GET /static/* ──────────────────────────────────────────────────────
  if (pathname.startsWith('/static/')) {
    const rel = pathname.slice('/static/'.length) || 'chat-prod.html';
    const filePath = path.resolve(CANVAS_DIR, rel);
    if (!filePath.startsWith(CANVAS_DIR)) {
      return json(res, 403, { error: 'Forbidden' });
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext  = path.extname(rel).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const noCache = ext === '.html'
        ? { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
        : {};
      res.writeHead(200, { 'Content-Type': mime, ...noCache });
      res.end(data);
    });
    return;
  }

  // ── /gw/* — 验证 JWT 后代理到 Gateway ────────────────────────────────────
  if (pathname.startsWith('/gw/') || pathname === '/gw') {
    const payload = verifyJWT(req);
    if (!payload) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    const username = payload.sub;
    const user = getUser(username);
    let gwPort = user?.port;

    if (!gwPort) {
      return json(res, 503, { error: 'No gateway port assigned' });
    }

    // 确保 Gateway 在跑（5s 内命中缓存直接跳过探测）
    const isOpen = await isGatewayAlive(gwPort);
    if (!isOpen) {
      initUserWorkspace(username);
      startGateway(username, gwPort);
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await checkPortOpen(gwPort)) { _gwAliveCache[gwPort] = Date.now(); break; }
      }
    }

    const gwPath = pathname.replace(/^\/gw/, '') || '/';
    const targetPath = gwPath + (url.search || '');

    let bodyBuf = Buffer.alloc(0);
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      bodyBuf = await readBody(req);
    }

    return proxyToGateway(req, res, gwPort, targetPath, bodyBuf);
  }

  // ── 默认 404 ──────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not Found' });
});

// ── 启动 ──────────────────────────────────────────────────────────────────
async function start() {
  if (!hasAnyUser()) {
    const combined = await hashPassword('admin123');
    createUser('admin', combined, 'admin');
    console.log('[auth-server-prod] 默认管理员已创建: admin / admin123');
  }

  server.listen(PORT, BIND_HOST, () => {
    console.log(`[auth-server-prod] listening on ${BIND_HOST}:${PORT}`);
    console.log(`  POST /login        — 登录获取 JWT`);
    console.log(`  GET  /static/*     — 托管 canvas-prod/ 目录`);
    console.log(`  ANY  /gw/*         — JWT 验证后代理到用户各自 Gateway`);
  });
}

// ── WS upgrade 代理 ───────────────────────────────────────────────────────
const wsProxy = httpProxy.createProxyServer({ ws: true });

wsProxy.on('error', (err, req, socket) => {
  if (err.code !== 'ECONNREFUSED') console.error('[ws-proxy] error:', err.message);
  if (socket && socket.destroy) socket.destroy();
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  // 验证 JWT（prod 只有单一 GW_PORT，无需按用户路由）
  try { jwt.verify(token, JWT_SECRET); } catch {
    socket.destroy(); return;
  }

  req.headers['authorization'] = `Bearer ${GW_TOKEN}`;
  try {
    wsProxy.ws(req, socket, head, { target: `ws://${GW_HOST}:${GW_PORT}` });
  } catch (err) {
    console.error('[ws-proxy] upgrade error:', err.message);
    socket.destroy();
  }
});

start().catch(err => {
  console.error('[auth-server-prod] 启动失败:', err);
  process.exit(1);
});
