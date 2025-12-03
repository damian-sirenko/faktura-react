// server/repos/usersRepo.js
const { query } = require("../db");
const bcrypt = require("bcryptjs");

async function findByEmail(email) {
  const rows = await query(
    "SELECT id, email, password_hash, is_active FROM users WHERE email=?",
    [email]
  );
  return rows[0] || null;
}

async function getUserRoles(userId) {
  const rows = await query(
    "SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?",
    [userId]
  );
  return rows.map((r) => r.name);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { findByEmail, verifyPassword, getUserRoles };
