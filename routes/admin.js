const express = require('express')
const { verifyToken, verifyAdmin } = require('../middleware/auth')
const { query, transaction } = require('../db.js')
const bcrypt = require('bcrypt')

const router = express.Router()

// 所有管理员路由都需要验证 token 和管理员权限
router.use(verifyToken)
router.use(verifyAdmin)

// ============ 用户管理 ============

// 获取所有用户
router.get('/users', async (req, res) => {
  try {
    const users = await query(
      `SELECT id, username, role, email, created_at, last_login, status, max_players 
       FROM users 
       ORDER BY created_at DESC`
    )
    
    res.json({ code: 200, data: users })
  } catch (err) {
    console.error('Get users error:', err)
    res.status(500).json({ error: '获取用户列表失败' })
  }
})

// 获取单个用户详情
router.get('/users/:userId', async (req, res) => {
  const { userId } = req.params
  
  try {
    const users = await query(
      `SELECT id, username, role, email, created_at, last_login, status, max_players 
       FROM users 
       WHERE id = ?`,
      [userId]
    )
    
    if (users.length === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    // 获取该用户的所有玩家
    const players = await query(
      `SELECT id, player_name, avatar, current_node_id, gold, created_at, last_played, is_active 
       FROM players 
       WHERE user_id = ?`,
      [userId]
    )
    
    res.json({
      code: 200,
      data: {
        ...users[0],
        players
      }
    })
  } catch (err) {
    console.error('Get user error:', err)
    res.status(500).json({ error: '获取用户信息失败' })
  }
})

// 修改用户状态（封禁/解封）
router.put('/users/:userId/status', async (req, res) => {
  const { userId } = req.params
  const { status } = req.body
  
  if (!['active', 'banned'].includes(status)) {
    return res.status(400).json({ error: '无效的状态值' })
  }
  
  try {
    // 不能封禁管理员自己
    if (parseInt(userId) === req.user.id) {
      return res.status(403).json({ error: '不能修改自己的状态' })
    }
    
    const result = await query(
      'UPDATE users SET status = ? WHERE id = ? AND role != "admin"',
      [status, userId]
    )
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在或不能修改管理员' })
    }
    
    res.json({
      code: 200,
      message: `用户已${status === 'active' ? '解封' : '封禁'}`
    })
  } catch (err) {
    console.error('Update user status error:', err)
    res.status(500).json({ error: '修改用户状态失败' })
  }
})

// 修改用户最大玩家数量
router.put('/users/:userId/max-players', async (req, res) => {
  const { userId } = req.params
  const { max_players } = req.body
  
  const max = parseInt(max_players)
  if (isNaN(max) || max < 1 || max > 10) {
    return res.status(400).json({ error: '最大玩家数必须在 1-10 之间' })
  }
  
  try {
    const result = await query(
      'UPDATE users SET max_players = ? WHERE id = ?',
      [max, userId]
    )
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    res.json({ code: 200, message: '最大玩家数已更新' })
  } catch (err) {
    console.error('Update max players error:', err)
    res.status(500).json({ error: '修改失败' })
  }
})

// 重置用户密码
router.put('/users/:userId/reset-password', async (req, res) => {
  const { userId } = req.params
  const { new_password } = req.body
  
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: '新密码长度至少 4 个字符' })
  }
  
  try {
    const hashedPassword = await bcrypt.hash(new_password, 10)
    
    const result = await query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hashedPassword, userId]
    )
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }
    
    res.json({ code: 200, message: '密码已重置' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: '重置密码失败' })
  }
})

// ============ 玩家管理 ============

// 获取所有玩家（全局）
router.get('/players', async (req, res) => {
  try {
    const players = await query(
      `SELECT p.*, u.username as owner_name 
       FROM players p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.is_active = TRUE 
       ORDER BY p.created_at DESC`
    )
    
    // 解析 JSON 字段
    const processedPlayers = players.map(player => ({
      ...player,
      inventory: (() => {
        try { return JSON.parse(player.inventory || '[]') } catch { return [] }
      })(),
      flags: (() => {
        try { return JSON.parse(player.flags || '{}') } catch { return {} }
      })()
    }))
    
    res.json({ code: 200, data: processedPlayers })
  } catch (err) {
    console.error('Get all players error:', err)
    res.status(500).json({ error: '获取玩家列表失败' })
  }
})

// 获取指定用户的所有玩家
router.get('/users/:userId/players', async (req, res) => {
  const { userId } = req.params
  
  try {
    const players = await query(
      `SELECT id, player_name, avatar, current_node_id, gold, inventory, flags, 
              created_at, last_played, is_active 
       FROM players 
       WHERE user_id = ?`,
      [userId]
    )
    
    const processedPlayers = players.map(player => ({
      ...player,
      inventory: (() => {
        try { return JSON.parse(player.inventory || '[]') } catch { return [] }
      })(),
      flags: (() => {
        try { return JSON.parse(player.flags || '{}') } catch { return {} }
      })()
    }))
    
    res.json({ code: 200, data: processedPlayers })
  } catch (err) {
    console.error('Get user players error:', err)
    res.status(500).json({ error: '获取玩家列表失败' })
  }
})

// 修改玩家数据（管理员修改）
router.put('/players/:playerId', async (req, res) => {
  const { playerId } = req.params
  const { player_name, avatar, current_node_id, gold, inventory, flags } = req.body
  
  try {
    const updates = []
    const values = []
    
    if (player_name !== undefined) {
      updates.push('player_name = ?')
      values.push(player_name)
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?')
      values.push(avatar)
    }
    if (current_node_id !== undefined) {
      updates.push('current_node_id = ?')
      values.push(current_node_id)
    }
    if (gold !== undefined) {
      updates.push('gold = ?')
      values.push(gold)
    }
    if (inventory !== undefined) {
      updates.push('inventory = ?')
      values.push(JSON.stringify(inventory))
    }
    if (flags !== undefined) {
      updates.push('flags = ?')
      values.push(JSON.stringify(flags))
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有需要修改的字段' })
    }
    
    values.push(playerId)
    
    const result = await query(
      `UPDATE players SET ${updates.join(', ')} WHERE id = ?`,
      values
    )
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '玩家不存在' })
    }
    
    // 记录管理员操作日志
    await query(
      `INSERT INTO game_logs (user_id, player_id, action, details) 
       VALUES (?, ?, ?, ?)`,
      [req.user.id, playerId, 'admin_edit', JSON.stringify(req.body)]
    )
    
    res.json({ code: 200, message: '玩家数据已修改' })
  } catch (err) {
    console.error('Admin edit player error:', err)
    res.status(500).json({ error: '修改玩家数据失败' })
  }
})

// 强制删除玩家（硬删除）
router.delete('/players/:playerId', async (req, res) => {
  const { playerId } = req.params
  
  try {
    const result = await query('DELETE FROM players WHERE id = ?', [playerId])
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '玩家不存在' })
    }
    
    res.json({ code: 200, message: '玩家已永久删除' })
  } catch (err) {
    console.error('Delete player error:', err)
    res.status(500).json({ error: '删除玩家失败' })
  }
})

// ============ 统计面板 ============

// 获取系统统计信息
router.get('/stats', async (req, res) => {
  try {
    // 用户统计
    const userStats = await query(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) as banned_users
       FROM users`
    )
    
    // 玩家统计
    const playerStats = await query(
      `SELECT 
        COUNT(*) as total_players,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_players,
        AVG(gold) as avg_gold
       FROM players`
    )
    
    // 今日活跃
    const todayActive = await query(
      `SELECT COUNT(DISTINCT user_id) as active_today 
       FROM players 
       WHERE DATE(last_played) = CURDATE()`
    )
    
    res.json({
      code: 200,
      data: {
        users: userStats[0],
        players: {
          ...playerStats[0],
          avg_gold: Math.round(playerStats[0].avg_gold || 0)
        },
        today_active: todayActive[0].active_today
      }
    })
  } catch (err) {
    console.error('Get stats error:', err)
    res.status(500).json({ error: '获取统计数据失败' })
  }
})

// 获取游戏日志
router.get('/logs', async (req, res) => {
  const { limit = 50, offset = 0, user_id, player_id } = req.query
  
  try {
    let sql = `
      SELECT l.*, u.username, p.player_name 
      FROM game_logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN players p ON l.player_id = p.id
      WHERE 1=1
    `
    const params = []
    
    if (user_id) {
      sql += ' AND l.user_id = ?'
      params.push(user_id)
    }
    if (player_id) {
      sql += ' AND l.player_id = ?'
      params.push(player_id)
    }
    
    sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit), parseInt(offset))
    
    const logs = await query(sql, params)
    
    res.json({ code: 200, data: logs })
  } catch (err) {
    console.error('Get logs error:', err)
    res.status(500).json({ error: '获取日志失败' })
  }
})

module.exports = router