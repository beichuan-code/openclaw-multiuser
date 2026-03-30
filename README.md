# OpenClaw MultiUser

> Enterprise-grade multi-user AI agent collaboration system built on top of [OpenClaw](https://openclaw.ai).

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## What is this?

OpenClaw MultiUser transforms OpenClaw into a full SaaS platform — each user gets their own isolated AI team with persistent memory, file access, and inter-agent collaboration.

```
User Browser
  └─ Auth Server (JWT) — multi-user routing
       └─ Per-User Gateway (OpenClaw)
            └─ Main Agent — orchestrator
                 ├─ Agent A — development
                 ├─ Agent B — content creation
                 ├─ Agent C — operations
                 └─ Agent D — general tasks
```

## Features

- **Multi-user isolation** — each user has their own OpenClaw gateway process, memory, and files
- **JWT authentication** — secure login with role-based access (admin / user)
- **Web chat UI** — mobile-friendly single-page app with streaming responses
- **Multi-agent collaboration** — agents delegate tasks to each other and report back
- **Session management** — multiple sessions per agent, persistent history
- **File sharing** — agents can produce and share downloadable files
- **Admin dashboard** — usage statistics per user and agent (token consumption, duration)
- **Segmented bubble output** — SSE-based streaming with paragraph-level bubbles

## Architecture

| Component | Description |
|-----------|-------------|
| `auth-server.js` | Express server — JWT auth, user management, gateway proxy, file server |
| `chat-prod.html` | Single-file web UI — login, chat, sessions, file management |
| `openclaw-server/` | Node.js/Express — avatar storage, agent metadata, message history (SQLite) |

## Requirements

- [OpenClaw](https://openclaw.ai) installed and configured
- Node.js 18+
- SQLite3

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/beichuan-code/openclaw-multiuser.git
cd openclaw-multiuser

# 2. Install dependencies
cd openclaw-server && npm install && cd ..

# 3. Set environment variables
export JWT_SECRET=your-strong-secret-here
export SERVER_HOST=your-server-ip
export AUTH_PORT=19000
export FILE_SERVER_PORT=3000

# 4. Start the auth server
node auth-server.js

# 5. Start the openclaw-server
cd openclaw-server && node src/index.js

# 6. Open the web UI
open http://localhost:19000/static/chat-prod.html
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `JWT_SECRET` | `openclaw-auth-secret-change-me` | **Change this in production!** |
| `AUTH_PORT` | `19000` | Auth server port |
| `FILE_SERVER_PORT` | `3000` | File/avatar server port |
| `SERVER_HOST` | `127.0.0.1` | Bind address |

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Commercial use requires a separate license. Contact: bczhou@gmail.com

## Acknowledgements

Built on top of [OpenClaw](https://openclaw.ai) — the open-source AI coding assistant.
