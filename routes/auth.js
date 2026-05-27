const express = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { query } = require('../db')

const router = express.Router()

/**
 * 用户注册
 * POST /api/register
 * Body: { username, password, email }
 */
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body

  // 1. 验证输入
  if (!username || !password) {
    return res.status(400).json({ 
      code: 400, 
      error: '用户名和密码不能为空' 
    })
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ 
      code: 400, 
      error: '用户名长度必须在 3-20 个字符之间' 
    })
  }

  if (password.length < 4) {
    return res.status(400).json({ 
      code: 400, 
      error: '密码长度至少需要 4 个字符' 
    })
  }

  // 用户名只能包含字母、数字、下划线
  const usernameRegex = /^[a-zA-Z0-9_]+$/
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      code: 400, 
      error: '用户名只能包含字母、数字和下划线' 
    })
  }

  try {
    // 2. 检查用户名是否已存在
    const existingUsers = await query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    )

    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        code: 400, 
        error: '用户名已被占用，请更换一个' 
      })
    }

    // 3. 加密密码
    const saltRounds = 10
    const passwordHash = await bcrypt.hash(password, saltRounds)

    // 4. 创建新用户
    const result = await query(
      `INSERT INTO users (username, password_hash, email, role, status, max_players) 
       VALUES (?, ?, ?, 'user', 'active', 3)`,
      [username, passwordHash, email || null]
    )

    // 5. 返回成功响应
    res.json({
      code: 200,
      message: '注册成功！请登录',
      data: {
        user_id: result.insertId,
        username: username
      }
    })

  } catch (err) {
    console.error('注册错误:', err)
    res.status(500).json({ 
      code: 500, 
      error: '注册失败，请稍后重试' 
    })
  }
})

/**
 * 用户登录
 * POST /api/login
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  // 1. 验证输入
  if (!username || !password) {
    return res.status(400).json({ 
      code: 400, 
      error: '请输入用户名和密码' 
    })
  }

  try {
    // 2. 查找用户
    const users = await query(
      `SELECT id, username, password_hash, role, status, max_players, created_at 
       FROM users 
       WHERE username = ?`,
      [username]
    )

    if (users.length === 0) {
      return res.status(401).json({ 
        code: 401, 
        error: '用户名或密码错误' 
      })
    }

    const user = users[0]

    // 3. 检查账号状态
    if (user.status === 'banned') {
      return res.status(403).json({ 
        code: 403, 
        error: '账号已被封禁，请联系管理员' 
      })
    }

    // 4. 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password_hash)
    if (!isPasswordValid) {
      return res.status(401).json({ 
        code: 401, 
        error: '用户名或密码错误' 
      })
    }

    // 5. 更新最后登录时间
    await query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    )

    // 6. 生成 JWT Token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'your_secret_key_here',
      { expiresIn: '7d' }  // 7天有效期
    )

    // 7. 返回登录成功信息
    res.json({
      code: 200,
      message: '登录成功',
      data: {
        user_id: user.id,
        username: user.username,
        role: user.role,
        token: token,
        max_players: user.max_players
      }
    })

  } catch (err) {
    console.error('登录错误:', err)
    res.status(500).json({ 
      code: 500, 
      error: '登录失败，请稍后重试' 
    })
  }
})

/**
 * 获取当前登录用户信息
 * GET /api/me
 * Headers: { Authorization: Bearer <token> }
 */
router.get('/me', async (req, res) => {
  // 从请求头获取 token
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      code: 401, 
      error: '请先登录' 
    })
  }

  const token = authHeader.split(' ')[1]

  try {
    // 验证 token
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_secret_key_here'
    )

    // 查询用户信息
    const users = await query(
      `SELECT id, username, role, email, created_at, last_login, status, max_players 
       FROM users 
       WHERE id = ?`,
      [decoded.id]
    )

    if (users.length === 0) {
      return res.status(404).json({ 
        code: 404, 
        error: '用户不存在' 
      })
    }

    const user = users[0]

    // 检查账号状态
    if (user.status === 'banned') {
      return res.status(403).json({ 
        code: 403, 
        error: '账号已被封禁' 
      })
    }

    res.json({
      code: 200,
      data: user
    })

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        code: 401, 
        error: '登录已过期，请重新登录' 
      })
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        code: 401, 
        error: '无效的登录凭证' 
      })
    }
    console.error('获取用户信息错误:', err)
    res.status(500).json({ 
      code: 500, 
      error: '获取用户信息失败' 
    })
  }
})

/**
 * 修改密码
 * PUT /api/change-password
 * Headers: { Authorization: Bearer <token> }
 * Body: { old_password, new_password }
 */
router.put('/change-password', async (req, res) => {
  // 验证登录状态
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      code: 401, 
      error: '请先登录' 
    })
  }

  const token = authHeader.split(' ')[1]
  const { old_password, new_password } = req.body

  // 验证输入
  if (!old_password || !new_password) {
    return res.status(400).json({ 
      code: 400, 
      error: '请填写旧密码和新密码' 
    })
  }

  if (new_password.length < 4) {
    return res.status(400).json({ 
      code: 400, 
      error: '新密码长度至少需要 4 个字符' 
    })
  }

  if (old_password === new_password) {
    return res.status(400).json({ 
      code: 400, 
      error: '新密码不能与旧密码相同' 
    })
  }

  try {
    // 验证 token
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_secret_key_here'
    )

    // 获取用户当前密码
    const users = await query(
      'SELECT password_hash FROM users WHERE id = ?',
      [decoded.id]
    )

    if (users.length === 0) {
      return res.status(404).json({ 
        code: 404, 
        error: '用户不存在' 
      })
    }

    // 验证旧密码
    const isPasswordValid = await bcrypt.compare(old_password, users[0].password_hash)
    if (!isPasswordValid) {
      return res.status(401).json({ 
        code: 401, 
        error: '旧密码错误' 
      })
    }

    // 加密新密码
    const newPasswordHash = await bcrypt.hash(new_password, 10)

    // 更新密码
    await query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, decoded.id]
    )

    res.json({
      code: 200,
      message: '密码修改成功，请使用新密码重新登录'
    })

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        code: 401, 
        error: '登录已过期，请重新登录' 
      })
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        code: 401, 
        error: '无效的登录凭证' 
      })
    }
    console.error('修改密码错误:', err)
    res.status(500).json({ 
      code: 500, 
      error: '修改密码失败，请稍后重试' 
    })
  }
})

/**
 * 刷新 Token（可选，用于延长登录时间）
 * POST /api/refresh-token
 * Headers: { Authorization: Bearer <token> }
 */
router.post('/refresh-token', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      code: 401, 
      error: '请先登录' 
    })
  }

  const token = authHeader.split(' ')[1]

  try {
    // 验证旧 token
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_secret_key_here',
      { ignoreExpiration: true }  // 允许过期也能刷新
    )

    // 检查用户是否仍然有效
    const users = await query(
      'SELECT id, username, role, status FROM users WHERE id = ?',
      [decoded.id]
    )

    if (users.length === 0 || users[0].status === 'banned') {
      return res.status(403).json({ 
        code: 403, 
        error: '账号已被封禁或不存在' 
      })
    }

    // 生成新 token
    const newToken = jwt.sign(
      { 
        id: users[0].id, 
        username: users[0].username, 
        role: users[0].role 
      },
      process.env.JWT_SECRET || 'your_secret_key_here',
      { expiresIn: '7d' }
    )

    res.json({
      code: 200,
      data: {
        token: newToken
      }
    })

  } catch (err) {
    console.error('刷新 token 错误:', err)
    res.status(401).json({ 
      code: 401, 
      error: '刷新失败，请重新登录' 
    })
  }
})

/**
 * 验证 Token 是否有效
 * GET /api/verify-token
 * Headers: { Authorization: Bearer <token> }
 */
router.get('/verify-token', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ code: 200, valid: false, message: '未提供 token' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'your_secret_key_here'
    )

    // 检查用户是否还存在且未被封禁
    const users = await query(
      'SELECT status FROM users WHERE id = ?',
      [decoded.id]
    )

    if (users.length === 0 || users[0].status === 'banned') {
      return res.json({ code: 200, valid: false, message: '账号已被封禁或不存在' })
    }

    res.json({ 
      code: 200, 
      valid: true, 
      data: { 
        user_id: decoded.id, 
        username: decoded.username,
        role: decoded.role 
      }
    })

  } catch (err) {
    res.json({ 
      code: 200, 
      valid: false, 
      message: err.name === 'TokenExpiredError' ? 'token 已过期' : 'token 无效'
    })
  }
})

module.exports = router