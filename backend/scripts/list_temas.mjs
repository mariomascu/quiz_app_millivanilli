import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const USE_DB = process.env.USE_DB === 'true';
  if (!USE_DB) {
    console.error('USE_DB !== true in .env; aborting');
    process.exit(2);
  }

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || '';

  let pool;
  try {
    pool = await mysql.createPool({ host, port, user, password, database, connectionLimit: 5 });
    const [rows] = await pool.query('SELECT id, nombre FROM temas');
    if (!rows || rows.length === 0) {
      console.log('No hay registros en la tabla temas (o la tabla no existe).');
    } else {
      console.log('Temas encontrados:');
      for (const r of rows) console.log(`${r.id} | ${r.nombre}`);
    }
  } catch (err) {
    console.error('Error conectando o consultando la DB:', err.message || err);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

main();
