// Run: node scripts/apply-migration.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '91c1e35c-a26b-4ef4-9bb2-4ee4b76cc911.hadb.ir',
  port: 29496,
  user: 'root',
  password: 'GCeETqyMW9RcllloW0cu',
  database: 'mysql',
  charset: 'utf8mb4',
  connectTimeout: 30000
});

(async () => {
  try {
    console.log('Connecting to remote MySQL...');
    const conn = await pool.getConnection();
    console.log('✅ Connected!');

    // Check if image_generations exists
    const [ig] = await conn.query("SHOW TABLES LIKE 'image_generations'");
    if (ig.length === 0) {
      console.log('⚠️ image_generations table does not exist yet.');
      console.log('   It will be auto-created when the server starts (DatabaseClient.init()).');
      conn.release();
      await pool.end();
      return;
    }

    // Check current status enum
    const [cols] = await conn.query("SHOW COLUMNS FROM image_generations WHERE Field = 'status'");
    console.log('Current status enum:', cols[0]?.Type);

    // Apply ALTER TABLE
    await conn.query(`ALTER TABLE image_generations MODIFY COLUMN status ENUM('QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED') NOT NULL DEFAULT 'QUEUE'`);
    console.log('✅ ALTER TABLE executed successfully');

    // Verify
    const [after] = await conn.query("SHOW COLUMNS FROM image_generations WHERE Field = 'status'");
    console.log('New status enum:', after[0]?.Type);

    conn.release();
    await pool.end();
    console.log('Done.');
  } catch (err) {
    console.error('❌ Error:', err.message);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
