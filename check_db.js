const Database = require('better-sqlite3');
const db = new Database('hifazat.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\n📦 DATABASE TABLES:\n');
tables.forEach(t => {
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get();
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name).join(', ');
  console.log(`  ${t.name} (${count.c} rows)`);
  console.log(`    Columns: ${cols}\n`);
});

console.log('\n👥 VOLUNTEER APPLICATIONS:');
const apps = db.prepare('SELECT app_id, full_name, gender, volunteer_type, ngo_name, city, status, created_at FROM volunteer_applications').all();
if (apps.length === 0) console.log('  No applications yet.');
else apps.forEach(a => console.log(`  [${a.app_id}] ${a.full_name} | ${a.gender} | ${a.volunteer_type} | ${a.city} | ${a.status}`));

console.log('\n👤 USERS:');
const users = db.prepare('SELECT id, name, email, created_at FROM users').all();
if (users.length === 0) console.log('  No users yet.');
else users.forEach(u => console.log(`  [${u.id}] ${u.name} | ${u.email} | ${u.created_at}`));

console.log('\n🚨 SOS INCIDENTS:');
const sos = db.prepare('SELECT id, user_id, address, status, created_at FROM sos_incidents').all();
if (sos.length === 0) console.log('  No SOS incidents yet.');
else sos.forEach(s => console.log(`  [${s.id}] User:${s.user_id} | ${s.address} | ${s.status}`));

db.close();
