import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User } from './models/User'; 

// 1. CONFIGURATION
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); 

// 2. DATABASE CONNECTION (MongoDB Atlas)
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("❌ MONGO_URI is missing in .env file");
    }
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};
connectDB();

// 3. AUTHENTICATION ROUTES

// A. Register
app.post('/api/auth/register', async (req, res): Promise<any> => {
  try {
    const { username, email, password, fullName, securityQuestion, securityAnswer } = req.body;
    
    // Validate Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: "Invalid email format." });

    // Validate Password
    if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: "Password must contain letters and numbers." });

    const cleanUsername = username.trim().toLowerCase();
    const existing = await User.findOne({ $or: [{ email }, { username: cleanUsername }] });
    if (existing) return res.status(400).json({ error: "Username or Email already taken" });

    // Hash Password & Security Answer
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), salt);

    const newUser = new User({
      username: cleanUsername,
      email, 
      password: hashedPassword, 
      fullName,
      securityQuestion, 
      securityAnswer: hashedAnswer
    });
    
    await newUser.save();
    console.log(`👤 New User Registered: ${cleanUsername}`);
    res.json({ message: "Registered successfully!" });
  } catch (e) {
    console.error("Register Error:", e);
    res.status(500).json({ error: "Server Error" });
  }
});

// B. Login
app.post('/api/auth/login', async (req, res): Promise<any> => {
  try {
    const { username, password } = req.body;
    const cleanUsername = username.trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(400).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid Credentials" });

    const token = jwt.sign(
      { id: user._id, username: user.username }, 
      process.env.JWT_SECRET as string, 
      { expiresIn: '24h' }
    );

    console.log(`🔑 Login: ${cleanUsername}`);
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ✅ C. Get Security Question (NEW - Fixes 'Action Failed')
app.get('/api/auth/security-question/:username', async (req, res): Promise<any> => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Return the question only
    res.json({ question: user.securityQuestion });
  } catch (error) {
    console.error("Fetch Question Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ D. Reset Password (NEW - Fixes 'Action Failed')
app.post('/api/auth/reset-password', async (req, res): Promise<any> => {
  try {
    const { username, securityAnswer, newPassword } = req.body;
    const cleanUsername = username.trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Verify Answer (Compare with stored hash)
    const isAnswerValid = await bcrypt.compare(securityAnswer.toLowerCase(), user.securityAnswer);
    if (!isAnswerValid) return res.status(400).json({ message: "Incorrect security answer" });

    // Hash New Password
    const salt = await bcrypt.genSalt(10);
    const newHashedPassword = await bcrypt.hash(newPassword, salt);

    // Update User
    user.password = newHashedPassword;
    await user.save();

    console.log(`🔐 Password Reset for: ${cleanUsername}`);
    res.json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Reset Error:", error);
    res.status(500).json({ error: "Reset failed" });
  }
});

// 4. AI LOGGING
app.post('/api/ai/analyze', (req, res) => {
  const { filename, size, algo, vector } = req.body;
  console.log(`🧠 AI Analysis | File: ${filename} | Algo: ${algo}`);
  res.json({ status: "Verified" });
});

// 5. SOCKET.IO SERVER
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8 
});

// Dual Map System for O(1) Access
const usernameToSocket = new Map<string, string>(); 
const socketToUsername = new Map<string, string>(); 

io.on('connection', (socket) => {
  console.log(`🔌 New Connection: ${socket.id}`);

  // A. Register User
  socket.on('register-user', (rawUsername: string) => {
    const username = rawUsername.trim().toLowerCase();
    const oldSocketId = usernameToSocket.get(username);
    if (oldSocketId && oldSocketId !== socket.id) {
       socketToUsername.delete(oldSocketId);
    }
    usernameToSocket.set(username, socket.id);
    socketToUsername.set(socket.id, username);
    
    console.log(`✅ Registered: ${username} -> ${socket.id}`);
    io.emit('user-online', { users: Array.from(usernameToSocket.keys()).map(u => ({ username: u })) });
  });

  // B. The Relay
  socket.on('file-relay', (data, ackCallback) => { 
    const { targetUsername, payload } = data;
    const cleanTarget = targetUsername.trim().toLowerCase();
    const targetSocketId = usernameToSocket.get(cleanTarget);
    
    if (targetSocketId) {
      const senderName = socketToUsername.get(socket.id);
      io.to(targetSocketId).emit('file-relay', { from: senderName, payload }, (responseFromReceiver: any) => {
        if (ackCallback) ackCallback(responseFromReceiver); 
      });
    } else {
      if (ackCallback) ackCallback({ error: "User offline or not found." });
    }
  });

  // ✅ D. User Check (Search Filter)
  socket.on('check-user', (targetUsername: string) => {
    if (!targetUsername) return;
    const cleanTarget = targetUsername.trim().toLowerCase();
    const isOnline = usernameToSocket.has(cleanTarget); 
    
    socket.emit('user-status', { 
      username: targetUsername, 
      status: isOnline ? 'online' : 'offline' 
    });
  });

  // C. Disconnect
  socket.on('disconnect', () => {
    const username = socketToUsername.get(socket.id);
    if (username) {
      console.log(`❌ Disconnected: ${username}`);
      usernameToSocket.delete(username);
      socketToUsername.delete(socket.id);
      io.emit('user-online', { users: Array.from(usernameToSocket.keys()).map(u => ({ username: u })) });
    }
  });
});

// API for User Polling
app.get('/api/users', (req, res) => {
  const users = Array.from(usernameToSocket.keys()).map(u => ({ username: u }));
  res.json({ users });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 SmartStream Server running on http://localhost:${PORT}`);
});