# V2EX 发帖

**节点：** /go/share 或 /go/programmer

**标题：** 开源了一个基于 OpenClaw 的多用户 AI Agent 协同平台

**正文：**

做了一个把 OpenClaw 变成多用户 SaaS 的系统，开源了出来。

## 它能做什么

给每个用户分配一支专属的 AI 团队，每个 Agent 有独立记忆和技能分工：

- 主 Agent 统筹协调
- 开发 Agent 写代码
- 运营 Agent 做内容
- 其他 Agent 处理日常任务

用户之间数据完全隔离，每人一个独立 Gateway 进程。

## 功能亮点

- JWT 多用户认证，支持 admin/user 角色
- 流式输出，分段气泡，类微信聊天体验
- Agent 之间可以互相派任务、汇报结果
- 内置文件管理、技能市场
- 单文件前端，部署简单

## 技术栈

Node.js + Express + SQLite + OpenClaw

## 截图

[聊天界面] [文件管理] [技能市场]
（附 GitHub README 里的截图链接）

## 链接

- GitHub: https://github.com/beichuan-code/openclaw-multiuser
- 协议: AGPL v3（商业使用需授权）

欢迎试用、提 Issue、Star ⭐

---

有问题可以直接回帖，我会回复。
