require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function createTable() {
  try {
    await client.connect();
    console.log('📦 Connected to PostgreSQL');

    const query = `
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        outfit_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await client.query(query);
    console.log('✅ submissions table is ready');
  } catch (err) {
    console.error('❌ Error setting up database:', err);
  } finally {
    await client.end();
  }
}

createTable();
