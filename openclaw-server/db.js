const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './data/openclaw.db' },
  useNullAsDefault: true,
});

async function init() {
  // 用户表（将来支持多用户登录）
  if (!await knex.schema.hasTable('users')) {
    await knex.schema.createTable('users', t => {
      t.increments('id').primary();
      t.string('username').notNullable().unique();
      t.string('display_name');
      t.string('avatar_path');       // 头像文件路径
      t.timestamps(true, true);
    });
    // 创建默认用户
    await knex('users').insert({ username: 'default', display_name: 'User' });
  }

  // 聊天历史表
  if (!await knex.schema.hasTable('messages')) {
    await knex.schema.createTable('messages', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().defaultTo(1);
      t.string('agent_id').notNullable();
      t.string('session_key');        // OpenClaw session key，便于对齐
      t.string('role').notNullable(); // 'user' | 'assistant'
      t.text('content').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.schema.raw('CREATE INDEX idx_messages_user_agent ON messages(user_id, agent_id)');
  }

  // Agent 自定义信息表
  if (!await knex.schema.hasTable('agents')) {
    await knex.schema.createTable('agents', t => {
      t.string('agent_id').notNullable();
      t.integer('user_id').notNullable().defaultTo(1);
      t.string('display_name');       // 用户自定义名称（覆盖服务端名称）
      t.string('avatar_path');        // 头像文件路径
      t.string('tag');                // 标签描述
      t.string('color');              // 头像背景色
      t.timestamps(true, true);
      t.primary(['agent_id', 'user_id']);
    });
  }
}

module.exports = { knex, init };
