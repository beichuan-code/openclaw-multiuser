const express = require('express');
const { knex } = require('../db');

const router = express.Router();

// GET /api/agents  — 获取所有 agent 自定义信息
router.get('/', async (req, res) => {
  const rows = await knex('agents').where('user_id', 1);
  // 返回 { agentId: { display_name, tag, color, avatarUrl } }
  const result = {};
  rows.forEach(r => {
    result[r.agent_id] = {
      display_name: r.display_name,
      tag:          r.tag,
      color:        r.color,
      avatar_url:   r.avatar_path ? `/api/avatar/agent/${r.agent_id}` : null,
    };
  });
  res.json(result);
});

// PATCH /api/agents/:id  — 更新 agent 自定义名称/标签/颜色
router.patch('/:id', async (req, res) => {
  const { display_name, tag, color } = req.body;
  const existing = await knex('agents').where({ agent_id: req.params.id, user_id: 1 }).first();
  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name;
  if (tag  !== undefined)          updates.tag  = tag;
  if (color !== undefined)         updates.color = color;

  if (existing) {
    await knex('agents').where({ agent_id: req.params.id, user_id: 1 }).update(updates);
  } else {
    await knex('agents').insert({ agent_id: req.params.id, user_id: 1, ...updates });
  }
  res.json({ ok: true });
});

module.exports = router;
