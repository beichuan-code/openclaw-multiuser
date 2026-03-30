const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { knex } = require('../db');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/avatars')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.params.type}_${req.params.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只支持图片格式'));
  },
});

// GET /api/avatar/user/:id  — 获取用户头像
router.get('/user/:id', async (req, res) => {
  const user = await knex('users').where('id', req.params.id).first();
  if (!user?.avatar_path || !fs.existsSync(user.avatar_path)) {
    return res.status(404).json({ error: 'no avatar' });
  }
  res.sendFile(path.resolve(user.avatar_path));
});

// POST /api/avatar/user/:id  — 上传用户头像
router.post('/user/:id', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const oldUser = await knex('users').where('id', req.params.id).first();
  if (oldUser?.avatar_path && fs.existsSync(oldUser.avatar_path)) {
    fs.unlinkSync(oldUser.avatar_path);
  }
  await knex('users').where('id', req.params.id).update({ avatar_path: req.file.path });
  res.json({ url: `/api/avatar/user/${req.params.id}?t=${Date.now()}` });
});

// GET /api/avatar/agent/:id  — 获取 agent 头像
router.get('/agent/:id', async (req, res) => {
  const agent = await knex('agents').where({ agent_id: req.params.id, user_id: 1 }).first();
  if (!agent?.avatar_path || !fs.existsSync(agent.avatar_path)) {
    return res.status(404).json({ error: 'no avatar' });
  }
  res.sendFile(path.resolve(agent.avatar_path));
});

// POST /api/avatar/agent/:id  — 上传 agent 头像
router.post('/agent/:id', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const existing = await knex('agents').where({ agent_id: req.params.id, user_id: 1 }).first();
  if (existing?.avatar_path && fs.existsSync(existing.avatar_path)) {
    fs.unlinkSync(existing.avatar_path);
  }
  if (existing) {
    await knex('agents').where({ agent_id: req.params.id, user_id: 1 }).update({ avatar_path: req.file.path });
  } else {
    await knex('agents').insert({ agent_id: req.params.id, user_id: 1, avatar_path: req.file.path });
  }
  res.json({ url: `/api/avatar/agent/${req.params.id}?t=${Date.now()}` });
});

module.exports = router;
