#!/usr/bin/env node
/**
 * sync-team.js — 根据用户的 openclaw.json 自动生成 TEAM.md
 *
 * 用法：
 *   node scripts/sync-team.js <configPath>
 *   configPath: 用户的 openclaw.json 路径，如
 *     C:\Users\Win10\.openclaw\workspace-prod\users\13901102779\openclaw.json
 *
 * 输出：<userDir>/.openclaw/TEAM.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const configPath = process.argv[2];
if (!configPath) {
  console.error('用法: node sync-team.js <configPath>');
  process.exit(1);
}

const userDir  = path.dirname(configPath);                     // .../users/13901102779
const userId   = path.basename(userDir);                       // 13901102779
const teamDir  = path.join(userDir, '.openclaw');
const teamPath = path.join(teamDir, 'TEAM.md');

// 读取 openclaw.json
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('读取 openclaw.json 失败:', e.message);
  process.exit(1);
}

// 读取 agent-display.json（含 role/desc）
let displayMap = {};
const displayPath = path.join(userDir, 'agent-display.json');
if (fs.existsSync(displayPath)) {
  try { displayMap = JSON.parse(fs.readFileSync(displayPath, 'utf8')); } catch {}
}

const agents = (cfg.agents && cfg.agents.list) || [];
if (!agents.length) {
  console.log('agents 列表为空，跳过 TEAM.md 生成');
  process.exit(0);
}

// 内置 agent 角色描述映射（fallback）
const BUILTIN_ROLE = {
  main:       '主 agent',
  yanchi:     '开发 agent',
  yingchuan:  '视频 agent',
  qinglan:    '新媒体 agent',
  shichen:    '杂务 agent',
};

// 构建成员表行
const rows = agents.map(a => {
  const name       = (a.identity && a.identity.name) || a.name || a.id;
  const sessionKey = `agent:${a.id}:${userId}`;
  const disp       = displayMap[a.id] || {};
  const role       = disp.role || BUILTIN_ROLE[a.id] || a.id;
  const agentDir   = a.agentDir ? a.agentDir.replace('{userDir}/', '') : `agents/${name}/`;
  return `| ${role.padEnd(12)} | ${name.padEnd(8)} | ${sessionKey.padEnd(30)} | ${agentDir} |`;
});

// 找到主 agent 行（id === 'main'）
const mainAgent = agents.find(a => a.id === 'main');
const mainName  = mainAgent ? (mainAgent.identity && mainAgent.identity.name) || mainAgent.name || 'main' : 'main';
const mainKey   = `agent:main:${userId}`;

const content = `# TEAM.md - 团队配置表

这是唯一一个写死名字和 session key 的地方。
规范、记忆、AGENTS.md 里只写角色，具体信息来这里查。

改名、迁移、新安装时，只需要更新这一个文件。
**本文件由 sync-team.js 自动生成，不要手动编辑。**

---

## 成员表

| 角色         | 当前名字 | Session Key                    | 工作目录         |
|--------------|----------|--------------------------------|------------------|
${rows.join('\n')}

---

## 汇报规则

任务完成后，向**主 agent** 汇报：
- Session Key：\`${mainKey}\`
- 方式：\`sessions_send(sessionKey, message)\`
- 内容：任务摘要 + 关键信息（如 commit hash）

---

## 改名/迁移时

1. 更新 openclaw.json 的 agents 配置
2. 运行 \`node scripts/sync-team.js\` 自动更新本文件
3. 更新各 agent 的 \`IDENTITY.md\`（名字字段）
`;

if (!fs.existsSync(teamDir)) fs.mkdirSync(teamDir, { recursive: true });
fs.writeFileSync(teamPath, content, 'utf8');
console.log(`TEAM.md 已更新：${teamPath}`);
