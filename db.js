const mysql = require('mysql2/promise')
const fs = require('fs')
const path = require('path')

// 读取 CA 证书（Aiven 需要）
let caCert = null
try {
  const certPath = path.join(__dirname, 'ca.pem')
  if (fs.existsSync(certPath)) {
    caCert = fs.readFileSync(certPath)
    console.log('CA certificate loaded from file')
  }
} catch (err) {
  console.log('CA certificate not found, will use env var or continue without SSL')
}

// 从环境变量读取配置
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 12345,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'defaultdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}

// 如果有 CA 证书，添加 SSL 配置
if (caCert) {
  dbConfig.ssl = {
    ca: caCert,
    rejectUnauthorized: true
  }
} else if (process.env.CA_CERT) {
  // 从环境变量读取证书内容
  dbConfig.ssl = {
    ca: process.env.CA_CERT,
    rejectUnauthorized: true
  }
}

let pool = null

async function getConnection() {
  if (!pool) {
    pool = mysql.createPool(dbConfig)
    console.log('MySQL connection pool created')
    
    // 测试连接
    try {
      const conn = await pool.getConnection()
      console.log('Database connected successfully')
      conn.release()
    } catch (err) {
      console.error('Database connection failed:', err.message)
    }
  }
  return pool
}

// 执行 SQL 查询的辅助函数
async function query(sql, params = []) {
  const pool = await getConnection()
  const [rows] = await pool.execute(sql, params)
  return rows
}

// 执行事务
async function transaction(callback) {
  const pool = await getConnection()
  const connection = await pool.getConnection()
  await connection.beginTransaction()
  try {
    const result = await callback(connection)
    await connection.commit()
    return result
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

module.exports = { getConnection, query, transaction }