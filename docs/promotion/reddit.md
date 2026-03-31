# Reddit Post

**Subreddits:** r/selfhosted, r/LocalLLaMA, r/ChatGPT

---

## r/selfhosted

**Title:** I built an open-source multi-user AI agent platform — each user gets their own AI team

**Body:**

I've been working on a system that turns [OpenClaw](https://openclaw.ai) into a multi-user SaaS platform. Just open-sourced it.

### What it does

Each user gets an isolated AI team with:
- A **main agent** that orchestrates tasks
- **Specialized agents** (coding, content, operations, etc.)
- Persistent memory and file access per user
- Full data isolation between users

### Features

- JWT auth with admin/user roles
- Streaming chat UI (WeChat-like bubble interface)
- Inter-agent task delegation and reporting
- Built-in file manager and skill marketplace
- Single HTML file frontend — dead simple to deploy

### Tech stack

Node.js, Express, SQLite, OpenClaw

### Screenshots

![Chat](https://raw.githubusercontent.com/beichuan-code/openclaw-multiuser/master/docs/screenshots/chat.jpg)
![Files](https://raw.githubusercontent.com/beichuan-code/openclaw-multiuser/master/docs/screenshots/file.jpg)
![Skills](https://raw.githubusercontent.com/beichuan-code/openclaw-multiuser/master/docs/screenshots/skills%20and%20tools.jpg)

### Links

- **GitHub**: https://github.com/beichuan-code/openclaw-multiuser
- **License**: AGPL v3 (commercial license available)

Would love feedback, issues, and stars!

---

## r/LocalLLaMA

**Title:** Open-sourced a multi-user platform for AI agent teams (built on OpenClaw + Claude)

**Body:**

(Same as above, add this paragraph at the top:)

If you're running Claude or other LLMs and want to give multiple users their own persistent AI team — I just open-sourced a system for that. Each user gets isolated agents with memory, file access, and inter-agent collaboration.
