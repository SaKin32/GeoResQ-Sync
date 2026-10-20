const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'disaster_rescue_jwt_secret_key_2026';

/**
 * Middleware: Verify JWT Token
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Bearer token missing in Authorization header.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, name, email, role }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.',
      error: error.message
    });
  }
};

/**
 * Middleware: Role-Based Authorization Guard
 * @param  {...string} allowedRoles 
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Restricted to roles: ${allowedRoles.join(', ')}.`
      });
    }
    next();
  };
};

/**
 * Middleware: Optional Token (attaches user if present, proceeds either way)
 */
const optionalToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch {
      // Ignore token failure for optional endpoints
    }
  }
  next();
};

module.exports = {
  verifyToken,
  authorizeRoles,
  optionalToken,
  JWT_SECRET
};
