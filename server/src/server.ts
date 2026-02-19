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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: "Invalid email format." });

    if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: "Password must contain letters and numbers." });

    const cleanUsername = username.trim().toLowerCase();
    const existing = await User.findOne({ $or: [{ email }, { username: cleanUsername }] });
    if (existing) return res.status(400).json({ error: "Username or Email already taken" });

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

// C. Get Security Question
app.get('/api/auth/security-question/:username', async (req, res): Promise<any> => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ question: user.securityQuestion });
  } catch (error) {
    console.error("Fetch Question Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// D. Reset Password
app.post('/api/auth/reset-password', async (req, res): Promise<any> => {
  try {
    const { username, securityAnswer, newPassword } = req.body;
    const cleanUsername = username.trim().toLowerCase();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isAnswerValid = await bcrypt.compare(securityAnswer.toLowerCase(), user.securityAnswer);
    if (!isAnswerValid) return res.status(400).json({ message: "Incorrect security answer" });

    const salt = await bcrypt.genSalt(10);
    const newHashedPassword = await bcrypt.hash(newPassword, salt);

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

// 5. SOCKET.IO SERVER (FULL MESH UPGRADE)
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8
});

// Data Structures
const usernameToSocket = new Map<string, string>();
const socketToUsername = new Map<string, string>();
const roomUsers: Record<string, { id: string, username: string }[]> = {}; // ✅ Tracks Room Membership

io.on('connection', (socket) => {
  console.log(`🔌 New Connection: ${socket.id}`);

  // A. Global Registration (For Login/Status)
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

  // B. JOIN ROOM (For Multi-Peer Mesh)
  socket.on('join-room', (roomId: string, username: string) => {
    console.log(`[Server] join-room event received: roomId=${roomId}, username=${username}, socketId=${socket.id}`);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    if (!roomUsers[roomId]) {
      roomUsers[roomId] = [];
      console.log(`[Server] Created new room: ${roomId}`);
    }

    // Add to room list if not already there
    if (!roomUsers[roomId].find(u => u.id === socket.id)) {
      roomUsers[roomId].push({ id: socket.id, username });
      console.log(`[Server] Added ${username} to room ${roomId}. Room now has ${roomUsers[roomId].length} users`);
    }

    console.log(`📢 ${username} joined Room: ${roomId}`);

    // 1. Tell everyone else: "New user joined!"
    const existingUsers = roomUsers[roomId].filter(u => u.id !== socket.id);
    console.log(`[Server] Broadcasting user-joined to others in room (${existingUsers.length} users will receive)`);
    socket.to(roomId).emit('user-joined', { id: socket.id, username });

    // 2. Tell new user: "Here is everyone else!"
    console.log(`[Server] Sending existing-users to ${username}: ${existingUsers.length} users`);
    socket.emit('existing-users', existingUsers);
  });

  // C. SIGNAL RELAY (Targeted P2P Handshake)
  // This replaces the old 'file-relay' for the mesh network
  socket.on('signal', ({ target, payload }) => {
    io.to(target).emit('signal', { sender: socket.id, payload });
  });

  // D. User Check (Search Filter - Backward Compatibility)
  socket.on('check-user', (targetUsername: string) => {
    if (!targetUsername) return;
    const cleanTarget = targetUsername.trim().toLowerCase();
    const isOnline = usernameToSocket.has(cleanTarget);

    socket.emit('user-status', {
      username: targetUsername,
      status: isOnline ? 'online' : 'offline'
    });
  });

  // F. Room Existence Check
  socket.on('check-room', (roomId: string) => {
    const exists = !!roomUsers[roomId] && roomUsers[roomId].length > 0;
    socket.emit('room-exists', { roomId, exists });
  });

  // G. Leave Room
  socket.on('leave-room', (roomId: string) => {
    console.log(`[Server] User ${socket.id} is leaving room ${roomId}`);
    socket.leave(roomId);

    // Explicitly clean up roomUsers
    if (roomUsers[roomId]) {
      roomUsers[roomId] = roomUsers[roomId].filter(u => u.id !== socket.id);

      // Notify others that this user left
      socket.to(roomId).emit('user-left', { id: socket.id });

      // Clean up empty rooms
      if (roomUsers[roomId].length === 0) {
        delete roomUsers[roomId];
      }
    }
  });

  // H. Sync Room Users (Periodic Refresh)
  socket.on('sync-room-users', (roomId: string) => {
    if (roomUsers[roomId]) {
      socket.emit('room-users-sync', roomUsers[roomId]);
    }
  });

  // E. Disconnect & Cleanup
  socket.on('disconnect', () => {
    const username = socketToUsername.get(socket.id);
    const { roomId } = socket.data;

    // 1. Remove from Global Map
    if (username) {
      console.log(`❌ Disconnected: ${username}`);
      usernameToSocket.delete(username);
      socketToUsername.delete(socket.id);
      io.emit('user-online', { users: Array.from(usernameToSocket.keys()).map(u => ({ username: u })) });
    }

    // 2. Remove from Room
    if (roomId && roomUsers[roomId]) {
      roomUsers[roomId] = roomUsers[roomId].filter(u => u.id !== socket.id);
      // Notify room members to close that specific connection
      io.to(roomId).emit('user-left', socket.id);

      // Clean up empty rooms
      if (roomUsers[roomId].length === 0) {
        delete roomUsers[roomId];
      }
    }
  });

  // F. Connection Request Relay
  socket.on('connection-request', ({ to, from, roomId }) => {
    const targetSocketId = usernameToSocket.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('connection-request', { from, roomId });
      console.log(`[Server] Relayed connection request from ${from} to ${to} for room ${roomId}`);
    }
  });

  // G. Connection Accept Handler
  socket.on('connection-accept', ({ to, roomId }) => {
    const targetSocketId = usernameToSocket.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('connection-accept', { roomId });
      console.log(`[Server] ${socket.id} accepted connection request, notified ${to} to join room ${roomId}`);
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