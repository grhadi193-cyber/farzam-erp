'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — using an insecure development default. Set JWT_SECRET in .env.');
}

function signUser(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'ورود لازم است' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'نشست نامعتبر یا منقضی است' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'دسترسی کافی نیست' });
    }
    return next();
  };
}

// Agent auth: separate static API key, never a user JWT.
function requireAgent(req, res, next) {
  const key = process.env.PIP_AGENT_API_KEY;
  if (!key) return res.status(503).json({ error: 'دسترسی ایجنت پیکربندی نشده است (PIP_AGENT_API_KEY)' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== key) return res.status(401).json({ error: 'کلید ایجنت نامعتبر است' });
  req.agent = { name: 'pip-agent' };
  return next();
}

module.exports = { signUser, requireAuth, requireRole, requireAgent };
