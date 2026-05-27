const jwt = require('jsonwebtoken')

// 验证 JWT Token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' })
  }
  
  const token = authHeader.split(' ')[1]
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key')
    req.user = decoded
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' })
    }
    return res.status(401).json({ error: '无效的认证令牌' })
  }
}

// 验证管理员权限
function verifyAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' })
  }
  next()
}

// 可选验证（不强制要求登录）
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key')
      req.user = decoded
    } catch (err) {
      // Token 无效，忽略
    }
  }
  next()
}

module.exports = { verifyToken, verifyAdmin, optionalAuth }