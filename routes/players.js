const express = require('express')
const { verifyToken } = require('../middleware/auth')
const { query } = require('../db.js')

const router = express.Router()

// 获取用户的所有玩家
router.get('/', verifyToken, async (req, res) => {
  try {
    const players = await query(
      `SELECT id, player_name, avatar, current_node_id, gold, 
              created_at, last_played, is_active 
       FROM players 
       WHERE user_id = ? AND is_active = TRUE 
       ORDER BY created_at ASC`,
      [req.user.id]
    )
    
    // 解析 JSON 字段（如果是 TEXT 类型存储的字符串）
    const processedPlayers = players.map(player => ({
      ...player,
      inventory: [],
      flags: {}
    }))
    
    res.json({ code: 200, data: processedPlayers })
  } catch (err) {
    console.error('Get players error:', err)
    res.status(500).json({ error: '获取玩家列表失败' })
  }
})

// 创建新玩家
router.post('/', verifyToken, async (req, res) => {
  const { player_name, avatar } = req.body
  
  if (!player_name || player_name.trim() === '') {
    return res.status(400).json({ error: '请输入玩家名称' })
  }
  
  if (player_name.length > 20) {
    return res.status(400).json({ error: '玩家名称不能超过 20 个字符' })
  }
  
  try {
    // 检查玩家数量限制
    const [user] = await query('SELECT max_players FROM users WHERE id = ?', [req.user.id])
    const playerCount = await query(
      'SELECT COUNT(*) as count FROM players WHERE user_id = ? AND is_active = TRUE',
      [req.user.id]
    )
    
    if (playerCount[0].count >= user[0].max_players) {
      return res.status(400).json({ error: `最多只能创建 ${user[0].max_players} 个玩家` })
    }
    
    // 检查同名玩家
    const existing = await query(
      'SELECT id FROM players WHERE user_id = ? AND player_name = ? AND is_active = TRUE',
      [req.user.id, player_name.trim()]
    )
    
    if (existing.length > 0) {
      return res.status(400).json({ error: '已存在相同名称的玩家' })
    }
    
    // 创建玩家
    const result = await query(
      `INSERT INTO players (user_id, player_name, avatar, current_node_id, gold, inventory, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, player_name.trim(), avatar || '😀', 'start', 500, '[]', '{}']
    )
    
    res.json({
      code: 200,
      message: '玩家创建成功',
      data: { player_id: result.insertId }
    })
  } catch (err) {
    console.error('Create player error:', err)
    res.status(500).json({ error: '创建玩家失败' })
  }
})

// 加载玩家游戏进度
router.get('/:playerId/load', verifyToken, async (req, res) => {
  const { playerId } = req.params
  
  try {
    const players = await query(
      `SELECT id, player_name, avatar, current_node_id, gold, inventory, flags, story_history
       FROM players 
       WHERE id = ? AND user_id = ? AND is_active = TRUE`,
      [playerId, req.user.id]
    )
    
    if (players.length === 0) {
      return res.status(404).json({ error: '玩家不存在' })
    }
    
    const player = players[0]
    
    // 解析 JSON/TEXT 字段
    let inventory = []
    let flags = {}
    let storyHistory = []
    
    try {
      inventory = player.inventory ? JSON.parse(player.inventory) : []
    } catch (e) { inventory = [] }
    
    try {
      flags = player.flags ? JSON.parse(player.flags) : {}
    } catch (e) { flags = {} }
    
    try {
      storyHistory = player.story_history ? JSON.parse(player.story_history) : []
    } catch (e) { storyHistory = [] }
    
    res.json({
      code: 200,
      data: {
        ...player,
        inventory,
        flags,
        story_history: storyHistory
      }
    })
  } catch (err) {
    console.error('Load player error:', err)
    res.status(500).json({ error: '加载游戏进度失败' })
  }
})

// 保存玩家游戏进度
router.put('/:playerId/save', verifyToken, async (req, res) => {
  const { playerId } = req.params
  const { current_node_id, gold, inventory, flags, story_history } = req.body
  
  try {
    // 验证玩家属于当前用户
    const players = await query(
      'SELECT id FROM players WHERE id = ? AND user_id = ? AND is_active = TRUE',
      [playerId, req.user.id]
    )
    
    if (players.length === 0) {
      return res.status(403).json({ error: '无权操作此玩家' })
    }
    
    // 构建更新语句
    const updates = []
    const values = []
    
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
    
    if (story_history !== undefined) {
      updates.push('story_history = ?')
      values.push(JSON.stringify(story_history))
    }
    
    updates.push('last_played = NOW()')
    
    if (updates.length === 1) {
      return res.status(400).json({ error: '没有需要保存的数据' })
    }
    
    values.push(playerId)
    
    await query(
      `UPDATE players SET ${updates.join(', ')} WHERE id = ?`,
      values
    )
    
    // 记录游戏日志（可选）
    await query(
      `INSERT INTO game_logs (user_id, player_id, action, details) 
       VALUES (?, ?, ?, ?)`,
      [req.user.id, playerId, 'save_game', JSON.stringify({ node: current_node_id, gold })]
    )
    
    res.json({ code: 200, message: '游戏进度已保存' })
  } catch (err) {
    console.error('Save player error:', err)
    res.status(500).json({ error: '保存游戏进度失败' })
  }
})

// 删除玩家（软删除）
router.delete('/:playerId', verifyToken, async (req, res) => {
  const { playerId } = req.params
  
  try {
    const result = await query(
      'UPDATE players SET is_active = FALSE WHERE id = ? AND user_id = ?',
      [playerId, req.user.id]
    )
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '玩家不存在' })
    }
    
    res.json({ code: 200, message: '玩家已删除' })
  } catch (err) {
    console.error('Delete player error:', err)
    res.status(500).json({ error: '删除玩家失败' })
  }
})

// 更新玩家信息（名称/头像）
router.put('/:playerId', verifyToken, async (req, res) => {
  const { playerId } = req.params
  const { player_name, avatar } = req.body
  
  try {
    const players = await query(
      'SELECT id FROM players WHERE id = ? AND user_id = ? AND is_active = TRUE',
      [playerId, req.user.id]
    )
    
    if (players.length === 0) {
      return res.status(404).json({ error: '玩家不存在' })
    }
    
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
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有需要更新的信息' })
    }
    
    values.push(playerId)
    
    await query(
      `UPDATE players SET ${updates.join(', ')} WHERE id = ?`,
      values
    )
    
    res.json({ code: 200, message: '玩家信息已更新' })
  } catch (err) {
    console.error('Update player error:', err)
    res.status(500).json({ error: '更新玩家信息失败' })
  }
})

module.exports = router