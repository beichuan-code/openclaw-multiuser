const express = require('express');
const router = express.Router();
const { knex } = require('../db');

// 保存一条消息
// POST /api/messages
// body: { agent_id, session_key, role, content, created_at? }
router.post('/', async (req, res) => {
  const { agent_id, session_key, role, content, created_at } = req.body;
  if (!agent_id || !role || !content) {
    return res.status(400).json({ error: 'agent_id, role, content required' });
  }
  const row = { user_id: 1, agent_id, session_key, role, content };
  if (created_at) row.created_at = created_at;
  const [id] = await knex('messages').insert(row);
  res.json({ id });
});

// 批量保存（前端同步整段历史用）
// POST /api/messages/batch
// body: { agent_id, session_key, messages: [{role, content, created_at}] }
router.post('/batch', async (req, res) => {
  const { agent_id, session_key, messages } = req.body;
  if (!agent_id || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'agent_id and messages[] required' });
  }
  const rows = messages.map(m => ({
    user_id: 1,
    agent_id,
    session_key: session_key || null,
    role: m.role,
    content: m.content,
    created_at: m.created_at || undefined,
  }));
  await knex('messages').insert(rows);
  res.json({ saved: rows.length });
});

// 查询某个 agent 的历史
// GET /api/messages/:agentId?limit=100&offset=0
router.get('/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const rows = await knex('messages')
    .where({ user_id: 1, agent_id: agentId })
    .orderBy('created_at', 'asc')
    .limit(limit)
    .offset(offset);
  res.json(rows);
});

// 删除某个 agent 的全部历史（慎用）
// DELETE /api/messages/:agentId
router.delete('/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const count = await knex('messages').where({ user_id: 1, agent_id: agentId }).delete();
  res.json({ deleted: count });
});

module.exports = router;
