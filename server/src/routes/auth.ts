import express from 'express';
import { login, register, getSecurityQuestion, resetPassword } from '../controllers/authController';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/security-question/:username', getSecurityQuestion); // New
router.post('/reset-password', resetPassword); // New

export default router;