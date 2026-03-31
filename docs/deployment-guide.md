# OpenClaw MultiUser 部署教程

> 从零开始搭建你的多用户 AI Agent 协同平台

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 推荐 LTS 版本 |
| OpenClaw | 最新版 | `npm install -g openclaw` |
| 操作系统 | Windows / Linux / macOS | 本文以 Windows 为例 |

## 第一步：安装 OpenClaw

```bash
npm install -g openclaw
openclaw --version
```

首次运行需要配置 API Key（支持 Anthropic 官方或第三方代理）：

```bash
openclaw onboard
```

按提示完成配置，确保能正常对话。

## 第二步：克隆项目

```bash
git clone https://github.com/beichuan-code/openclaw-multiuser.git
cd openclaw-multiuser
```

## 第三步：安装依赖

```bash
cd openclaw-server
npm install
cd ..
```

auth-server 依赖的包：

```bash
npm install jsonwebtoken http-proxy better-sqlite3
```

## 第四步：目录结构准备

创建工作目录：

```bash
mkdir -p workspace-prod/users
mkdir -p workspace-prod/canvas-prod
mkdir -p workspace-prod/template
mkdir -p workspace-prod/shared
mkdir -p workspace-prod/scripts
```

将文件放到对应位置：

```bash
# 前端
cp chat-prod.html workspace-prod/canvas-prod/

# 认证服务
cp auth-server.js workspace-prod/shared/auth-server-prod.js

# 团队同步脚本
cp scripts/sync-team.js workspace-prod/scripts/

# openclaw-server 保持在项目根目录
```

## 第五步：配置 Agent 模板

创建模板目录，新用户注册时会自动复制这些文件：

```bash
mkdir -p workspace-prod/template
```

创建 `workspace-prod/template/openclaw.json`：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "default": {
        "baseUrl": "https://api.anthropic.com/",
        "apiKey": "YOUR_API_KEY",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 16000
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "default/claude-sonnet-4-6"
      }
    },
    "list": [
      {
        "id": "main",
        "name": "主Agent",
        "identity": { "name": "主Agent", "emoji": "🤖" }
      }
    ]
  },
  "tools": {
    "profile": "full",
    "agentToAgent": { "enabled": true }
  }
}
```

> **注意**：将 `YOUR_API_KEY` 替换为你的实际 API Key。支持 Anthropic 官方或第三方代理（修改 baseUrl）。

## 第六步：配置环境变量

```bash
# 必须修改！生产环境请使用强密码
export JWT_SECRET="your-strong-random-secret-here"
```

其他可选配置（auth-server-prod.js 顶部）：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 19000 | 认证服务端口 |
| `BIND_HOST` | 0.0.0.0 | 绑定地址 |
| `GW_TOKEN` | 随机生成 | Gateway 通信令牌 |
| `WORKSPACE_ROOT` | workspace-prod/users | 用户数据目录 |
| `TEMPLATE_DIR` | workspace-prod/template | 新用户模板目录 |

## 第七步：启动服务

需要启动两个服务：

### 1. 启动 auth-server（认证 + 代理）

```bash
node workspace-prod/shared/auth-server-prod.js
```

### 2. 启动 openclaw-server（头像 + 消息存储）

```bash
cd openclaw-server
node src/index.js
```

### 使用 PM2 管理（推荐）

```bash
npm install -g pm2

pm2 start workspace-prod/shared/auth-server-prod.js --name auth-server
pm2 start openclaw-server/src/index.js --name openclaw-server
pm2 save
pm2 startup  # 开机自启
```

## 第八步：访问系统

打开浏览器访问：

```
http://your-server-ip:19000/static/chat-prod.html
```

### 首次登录

系统会自动创建管理员账号：
- 用户名：`admin`
- 密码：首次访问时设置

### 创建普通用户

管理员登录后，在设置中可以创建新用户。每个新用户会自动：
1. 从模板复制配置文件
2. 启动独立的 OpenClaw Gateway 进程
3. 获得完全隔离的工作空间

## 第九步：添加更多 Agent

在前端通讯录页面添加新 Agent，或直接编辑用户的 `openclaw.json`：

```json
{
  "agents": {
    "list": [
      { "id": "main", "name": "凌霄", "identity": { "name": "凌霄", "emoji": "🌤" } },
      { "id": "dev", "name": "开发", "identity": { "name": "开发", "emoji": "💻" } },
      { "id": "writer", "name": "写作", "identity": { "name": "写作", "emoji": "✍️" } }
    ]
  }
}
```

保存后系统会自动热重载 Gateway，无需手动重启。

## 常见问题

### Q: Gateway 启动失败？

检查 OpenClaw 是否正确安装：
```bash
openclaw --version
openclaw gateway run --port 28000
```

### Q: 端口被占用？

```bash
# Linux/Mac
lsof -i :19000
# Windows
netstat -ano | findstr :19000
```

### Q: 多用户内存占用大？

每个用户一个 Gateway 进程，约占 200-500MB。100+ 用户建议：
- 服务器至少 32GB 内存
- 使用按需唤醒策略（不活跃用户暂停 Gateway）

### Q: 如何使用第三方 API 代理？

修改模板中的 `baseUrl`：
```json
{
  "baseUrl": "https://your-proxy.com/",
  "apiKey": "your-proxy-key"
}
```

支持所有 Anthropic API 兼容的代理服务。

## 架构图

```
                    ┌─────────────────────────────────┐
                    │         用户浏览器 (chat-prod.html)        │
                    └──────────────┬──────────────────┘
                                   │ HTTP/SSE
                    ┌──────────────▼──────────────────┐
                    │     auth-server (:19000)         │
                    │   JWT 认证 + 反向代理 + 文件服务  │
                    └──┬───────┬───────┬──────────────┘
                       │       │       │
              ┌────────▼┐ ┌───▼────┐ ┌▼────────┐
              │ User-A   │ │ User-B │ │ User-C  │
              │ GW:28001 │ │ GW:28002│ │ GW:28003│
              └────┬─────┘ └───┬────┘ └────┬────┘
                   │           │            │
              ┌────▼─────┐    ...          ...
              │ 凌霄(main)│
              │ 砚池(dev) │
              │ 映川(video)│
              └──────────┘
```

## 更新升级

```bash
cd openclaw-multiuser
git pull origin master
pm2 restart all
```

---

如有问题，欢迎提 Issue：https://github.com/beichuan-code/openclaw-multiuser/issues
