import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password, securityQuestion, securityAnswer } = req.body;
    
    const exists = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
    if (exists) {
       res.status(400).json({ message: "User already exists" });
       return;
    }

    // Hash BOTH password and security answer (normalized to lowercase)
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), 10);

    const user = await prisma.user.create({
      data: { 
        username, 
        email, 
        password: hashedPassword, 
        securityQuestion, 
        securityAnswer: hashedAnswer 
      }
    });

    res.status(201).json({ userId: user.id, message: "User created" });
  } catch (error) {
    res.status(500).json({ error: "Registration failed" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
       res.status(400).json({ message: "Invalid credentials" });
       return;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
};

// --- NEW FUNCTIONS ---

export const getSecurityQuestion = async (req: Request, res: Response) => {
  try {
    const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Return the question so the user can answer it
    res.json({ question: user.securityQuestion });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { username, securityAnswer, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Verify the security answer
    const isAnswerValid = await bcrypt.compare(securityAnswer.toLowerCase(), user.securityAnswer);
    
    if (!isAnswerValid) {
      res.status(400).json({ message: "Incorrect security answer" });
      return;
    }

    // Hash the new password and update
    const newHashedPassword = await bcrypt.hash(newPassword, 10);
    
    await prisma.user.update({
      where: { id: user.id },
      data: { password: newHashedPassword }
    });

    res.json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ error: "Reset failed" });
  }
};