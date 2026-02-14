// server/routes/auth.ts
import express from 'express';
import { register, login, getSecurityQuestion, resetPassword } from '../controllers/authController';

const router = express.Router();

// 1. Existing Routes
router.post('/register', register);
router.post('/login', login);

// 2. NEW ROUTES (This is what you were missing!)
router.get('/security-question/:username', getSecurityQuestion);
router.post('/reset-password', resetPassword);

export default router;