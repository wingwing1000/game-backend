const express = require('express')
const cors = require('cors')
const { getConnection } = require('./db')

// 导入路由
const authRoutes = require('./routes/auth')
const playerRoutes = require('./routes/players')
const adminRoutes = require('./routes/admin')

const app = express()

// 中间件
app.use(cors())
app.use(express.json())

// 请求日志中间件（开发用）
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// 注册路由
app.use('/api', authRoutes)      // 认证相关：/api/register, /api/login
app.use('/api/players', playerRoutes)  // 玩家管理：/api/players
app.use('/api/admin', adminRoutes)     // 管理员：/api/admin/...

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Server error:', err)
  res.status(500).json({ error: '服务器内部错误' })
})

// 启动服务器
const PORT = process.env.PORT || 3000

// 先初始化数据库连接，再启动服务
getConnection().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Health check: http://localhost:${PORT}/health`)
  })
}).catch(err => {
  console.error('Failed to connect to database:', err)
  process.exit(1)
})