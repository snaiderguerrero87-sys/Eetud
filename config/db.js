const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 4000,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false
    }
});

async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log('✅ Base de datos TiDB conectada');
        conn.release();
    } catch (error) {
        console.error('❌ Error de conexión a TiDB:', error.message);
    }
}

module.exports = { pool, testConnection };