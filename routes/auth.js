// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../server/db.js");
const {
  authRequired,
  signSession,
  setAuthCookie,
  clearAuthCookie,
} = require("../backend/middleware/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: "Brakuje e-mail/hasła" });
      }
  
      const rows = await query(
        `SELECT id, email, password_hash, is_active FROM users WHERE email=? LIMIT 1`,
        [email.trim()]
      );
      const user = rows[0];
      if (!user || !user.is_active) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }
  
      const ok = await bcrypt.compare(String(password), String(user.password_hash || ""));
      if (!ok) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }
  
      // генеруємо сесію
      const token = signSession({ uid: user.id, email: user.email });
  
      // кука (для продакшну/одного домену)
      setAuthCookie(res, token);
  
      // ВАЖЛИВО: повертаємо token для Bearer у деві (5173↔3000)
      return res.json({
        success: true,
        token,
        user: { id: user.id, email: user.email },
      });
    } catch (e) {
      console.error("POST /auth/login error:", e);
      return res.status(500).json({ error: "Błąd logowania" });
    }
  });
  

// POST /auth/logout
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

// GET /auth/me
router.get("/me", authRequired, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
