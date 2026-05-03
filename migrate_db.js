const Database = require('better-sqlite3');
const db = new Database('hifazat.db');

console.log('🔧 Running database migration...\n');

// Add missing columns to volunteer_applications
const existingCols = db.prepare("PRAGMA table_info(volunteer_applications)").all().map(c => c.name);
console.log('Existing columns:', existingCols.join(', '));

const toAdd = [
  { name: 'gender',          def: "TEXT DEFAULT 'female'" },
  { name: 'volunteer_type',  def: "TEXT DEFAULT 'individual'" },
  { name: 'ngo_name',        def: "TEXT" },
  { name: 'ngo_reg_number',  def: "TEXT" },
];

toAdd.forEach(col => {
  if (!existingCols.includes(col.name)) {
    db.prepare(`ALTER TABLE volunteer_applications ADD COLUMN ${col.name} ${col.def}`).run();
    console.log(`  ✅ Added column: ${col.name}`);
  } else {
    console.log(`  ⏭  Column already exists: ${col.name}`);
  }
});

console.log('\n✅ Migration complete.\n');

// Show final schema
const finalCols = db.prepare("PRAGMA table_info(volunteer_applications)").all().map(c => c.name);
console.log('Final columns:', finalCols.join(', '));

// Show all data
console.log('\n👥 VOLUNTEER APPLICATIONS:');
const apps = db.prepare('SELECT app_id, full_name, gender, volunteer_type, ngo_name, city, status, created_at FROM volunteer_applications').all();
if (apps.length === 0) {
  console.log('  No applications yet.');
} else {
  apps.forEach(a => console.log(`  [${a.app_id}] ${a.full_name} | ${a.gender || 'female'} | ${a.volunteer_type || 'individual'} | ${a.city} | ${a.status}`));
}

console.log('\n👤 USERS:');
const users = db.prepare('SELECT id, name, email, created_at FROM users').all();
if (users.length === 0) {
  console.log('  No users yet.');
} else {
  users.forEach(u => console.log(`  [${u.id}] ${u.name} | ${u.email} | ${u.created_at}`));
}

console.log('\n🚨 SOS INCIDENTS:');
const sos = db.prepare('SELECT id, user_id, address, status, created_at FROM sos_incidents').all();
if (sos.length === 0) {
  console.log('  No SOS incidents yet.');
} else {
  sos.forEach(s => console.log(`  [${s.id}] User:${s.user_id} | ${s.address} | ${s.status}`));
}

console.log('\n📍 LOCATION HISTORY (last 5):');
const locs = db.prepare('SELECT id, user_id, latitude, longitude, address, created_at FROM location_history ORDER BY created_at DESC LIMIT 5').all();
if (locs.length === 0) {
  console.log('  No location history yet.');
} else {
  locs.forEach(l => console.log(`  [${l.id}] User:${l.user_id} | ${l.latitude?.toFixed(4)},${l.longitude?.toFixed(4)} | ${l.address || '—'}`));
}

console.log('\n🛡️ DEEPFAKE REPORTS:');
const reports = db.prepare('SELECT report_id, user_id, file_type, ai_confidence, status, created_at FROM deepfake_reports').all();
if (reports.length === 0) {
  console.log('  No reports yet.');
} else {
  reports.forEach(r => console.log(`  [${r.report_id}] User:${r.user_id} | ${r.file_type} | AI:${r.ai_confidence}% | ${r.status}`));
}

console.log('\n📞 TRUSTED CONTACTS:');
const contacts = db.prepare('SELECT id, user_id, name, phone, relationship FROM trusted_contacts').all();
if (contacts.length === 0) {
  console.log('  No contacts yet.');
} else {
  contacts.forEach(c => console.log(`  [${c.id}] User:${c.user_id} | ${c.name} | ${c.phone} | ${c.relationship}`));
}

db.close();
