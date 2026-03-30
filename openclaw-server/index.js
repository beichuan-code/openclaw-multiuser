const express = require('express');
const cors    = require('cors');
const path    = require('path');
const http    = require('http');
const { init } = require('./db');

const app  = express();
const PORT = 3000;

app.use(cors({ origin: '*' }));

// 代理 OpenClaw Gateway（解决 18790 跨域问题）
// 放在 express.json() 前面，用原始流转发
app.use('/gw', (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: 18789,
    path: req.url || '/',
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:18789' },
  };
  const proxy = http.request(options, (gwRes) => {
    res.writeHead(gwRes.statusCode, {
      ...gwRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH, DELETE',
    });
    gwRes.pipe(res);
  });
  proxy.on('error', () => res.status(502).json({ error: 'gateway unreachable' }));
  req.pipe(proxy);
});

// OPTIONS preflight
app.options('/gw/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');
  res.sendStatus(204);
});

app.use(express.json());

// 静态文件 — canvas UI
app.use('/ui', express.static(path.join(__dirname, '../../canvas')));

// API 路由
app.use('/api/avatar', require('./routes/avatars'));
app.use('/api/agents', require('./routes/agents'));
app.use('/api/messages', require('./routes/messages'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 捕获未处理异常，防止进程崩溃
process.on('uncaughtException', err => console.error('[uncaughtException]', err));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// 启动
init().then(() => {
  app.listen(PORT, () => {
    console.log(`OpenClaw Server running on http://127.0.0.1:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
