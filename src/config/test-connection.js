// test-connection.js
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL);

console.log('Connecting...');
const result = await sql`SELECT NOW()`;
console.log('Success:', result);