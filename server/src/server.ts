import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User } from './models/User'; // Ensure this model exists

// 1. CONFIGURATION
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Higher limit for AI metadata

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

// Register
app.post('/api/auth/register', async (req, res): Promise<any> => {
  try {
    const { username, email, password, fullName, securityQuestion, securityAnswer } = req.body;
    
    // Normalize Username
    const cleanUsername = username.trim().toLowerCase();

    const existing = await User.findOne({ $or: [{ email }, { username: cleanUsername }] });
    if (existing) return res.status(400).json({ error: "Username or Email already taken" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), salt);

    const newUser = new User({
      username: cleanUsername, // Store lowercase for consistency
      email, 
      password: hashedPassword, 
      fullName,
      securityQuestion, 
      securityAnswer: hashedAnswer
    });
    
    await newUser.save();
    console.log(`👤 New User: ${cleanUsername}`);
    res.json({ message: "Registered successfully!" });
  } catch (e) {
    res.status(500).json({ error: "Server Error" });
  }
});

// Login
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

// 4. AI LOGGING (Metadata only)
app.post('/api/ai/analyze', (req, res) => {
  const { filename, size, algo, vector } = req.body;
  console.log(`🧠 AI Analysis | File: ${filename} | Algo: ${algo}`);
  res.json({ status: "Verified" });
});

// 5. SOCKET.IO SERVER (The Relay)
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8 
});

const userRegistry = new Map<string, string>();

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // A. Register User
  socket.on('register-user', (username: string) => {
    // Normalize for consistent lookup
    userRegistry.set(socket.id, username.trim().toLowerCase());
    console.log(`✅ Registered: ${username} (${socket.id})`);
    
    // Broadcast list (for Polling API updates)
    io.emit('user-online', { users: Array.from(userRegistry.values()) });
  });

  // B. The Relay (Robust Version)
  socket.on('file-relay', (data, ackCallback) => { 
    const { targetUsername, payload } = data;
    const cleanTarget = targetUsername.trim().toLowerCase();
    
    // Find target socket by Value (Username)
    // Note: In production with Map, iterating entries is O(N). For <1000 users this is fine.
    const targetEntry = Array.from(userRegistry.entries()).find(
      ([_, name]) => name === cleanTarget
    );
    
    if (targetEntry) {
      const [targetSocketId, _] = targetEntry;
      const senderName = userRegistry.get(socket.id); // Get real sender name

      // Forward to Receiver
      io.to(targetSocketId).emit('file-relay', { from: senderName, payload }, (responseFromReceiver: any) => {
        // Pass the ACK back to Sender
        if (ackCallback) ackCallback(responseFromReceiver); 
      });
    } else {
      // 🚨 CRITICAL: Send error back if user not found
      console.warn(`⚠️ Relay Failed: '${cleanTarget}' not found.`);
      if (ackCallback) {
        ackCallback({ error: "User offline or not found." });
      }
    }
  });

  // C. Disconnect
  socket.on('disconnect', () => {
    userRegistry.delete(socket.id);
    io.emit('user-online', { users: Array.from(userRegistry.values()) });
  });
});

// API for User Polling (Watchdog)
app.get('/api/users', (req, res) => {
  const users = Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name }));
  res.json({ users });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 SmartStream Server running on http://localhost:${PORT}`);
});





// import express from 'express';
// import { createServer } from 'http';
// import { Server } from 'socket.io';
// import cors from 'cors';
// import mongoose from 'mongoose';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';
// import dotenv from 'dotenv';
// import { User } from './models/User'; // Ensure you created this file!

// // 1. CONFIGURATION
// dotenv.config();
// const app = express();
// const PORT = process.env.PORT || 3001;

// // Middleware
// app.use(cors());
// // Increase JSON limit to handle the entropy vector arrays from the client
// app.use(express.json({ limit: '10mb' })); 

// // 2. DATABASE CONNECTION (MongoDB Atlas)
// const connectDB = async () => {
//   try {
//     if (!process.env.MONGO_URI) {
//       throw new Error("❌ MONGO_URI is missing in .env file");
//     }
//     const conn = await mongoose.connect(process.env.MONGO_URI);
//     console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
//   } catch (error) {
//     console.error('❌ MongoDB Connection Error:', error);
//     process.exit(1); // Stop server if DB fails
//   }
// };
// connectDB();

// // 3. AUTHENTICATION ROUTES (Step 1 Requirement)

// // Register New User
// app.post('/api/auth/register', async (req, res): Promise<any> => {
//   try {
//     const { username, email, password, fullName, securityQuestion, securityAnswer } = req.body;
    
//     // Check if user exists
//     const existing = await User.findOne({ $or: [{ email }, { username }] });
//     if (existing) return res.status(400).json({ error: "Username or Email already taken" });

//     // Hash Password & Security Answer
//     const salt = await bcrypt.genSalt(10);
//     const hashedPassword = await bcrypt.hash(password, salt);
//     const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), salt);

//     const newUser = new User({
//       username, 
//       email, 
//       password: hashedPassword, 
//       fullName,
//       securityQuestion, 
//       securityAnswer: hashedAnswer
//     });
    
//     await newUser.save();
//     console.log(`👤 New User Registered: ${username}`);
//     res.json({ message: "User registered successfully!" });
//   } catch (e) {
//     console.error("Register Error:", e);
//     res.status(500).json({ error: "Server Error" });
//   }
// });

// // Login User
// app.post('/api/auth/login', async (req, res): Promise<any> => {
//   try {
//     const { username, password } = req.body;
    
//     // Find User
//     const user = await User.findOne({ username });
//     if (!user) return res.status(400).json({ error: "User not found" });

//     // Verify Password
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) return res.status(400).json({ error: "Invalid Credentials" });

//     // Create Session Token (JWT)
//     const token = jwt.sign(
//       { id: user._id, username: user.username }, 
//       process.env.JWT_SECRET as string, 
//       { expiresIn: '24h' }
//     );

//     console.log(`🔑 Login Success: ${username}`);
//     res.json({ token, username: user.username });
//   } catch (e) {
//     console.error("Login Error:", e);
//     res.status(500).json({ error: "Login failed" });
//   }
// });

// // 4. AI METADATA ANALYTICS (Step 2 Requirement)
// // The client sends file info here BEFORE transfer to prove it analyzed the file.
// app.post('/api/ai/analyze', (req, res) => {
//   const { filename, size, algo, vector } = req.body;
  
//   // Log the analysis to console (In real app, save to DB stats)
//   console.log(`🧠 AI Cloud Analysis | File: ${filename}`);
//   console.log(`📊 Vector Sample: [${vector.slice(0, 5)}...] (Length: ${vector.length})`);
//   console.log(`🤖 Algorithm Approved: ${algo}`);

//   res.json({ status: "Verified", timestamp: new Date() });
// });

// // 5. SOCKET.IO SERVER (File Transfer Relay)
// const httpServer = createServer(app);
// const io = new Server(httpServer, {
//   cors: { origin: "*" },
//   maxHttpBufferSize: 1e8 // 100MB chunk limit
// });

// // User Registry: Maps Socket ID -> Username
// const userRegistry = new Map<string, string>();

// io.on('connection', (socket) => {
//   console.log(`🔌 New Connection: ${socket.id}`);

//   // A. Register User
//   socket.on('register-user', (username: string) => {
//     userRegistry.set(socket.id, username);
//     console.log(`✅ Socket Registered: ${username} (${socket.id})`);
//     // Broadcast updated list to everyone
//     io.emit('user-online', { 
//       users: Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name })) 
//     });
//   });

//   // B. The Relay (With Stop-and-Wait Support)
//   socket.on('file-relay', (data, ackCallback) => { 
//     const { targetUsername, payload } = data;
    
//     // Normalize lookup (Case-insensitive & Trimmed)
//     const targetEntry = Array.from(userRegistry.entries()).find(
//       ([_, name]) => name.trim().toLowerCase() === targetUsername.trim().toLowerCase()
//     );
    
//     if (targetEntry) {
//       const [targetSocketId, _] = targetEntry;
//       const senderName = userRegistry.get(socket.id);

//       // Forward to Receiver
//       io.to(targetSocketId).emit('file-relay', { from: senderName, payload }, (responseFromReceiver: any) => {
//         if (ackCallback) ackCallback(responseFromReceiver); 
//       });
//     } else {
//       // 🚨 CRITICAL FIX: Tell the Sender that the user is missing!
//       console.warn(`⚠️ Relay Failed: Target '${targetUsername}' not found.`);
//       if (ackCallback) {
//         ackCallback({ error: "User not found or offline." });
//       }
//     }
//   });

//   // C. Disconnect
//   socket.on('disconnect', () => {
//     const user = userRegistry.get(socket.id);
//     if (user) {
//       console.log(`❌ Disconnected: ${user}`);
//       userRegistry.delete(socket.id);
//       io.emit('user-online', { 
//         users: Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name })) 
//       });
//     }
//   });
// });

// // API for Polling Users (Backup for frontend)
// app.get('/api/users', (req, res) => {
//   const users = Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name }));
//   res.json({ users });
// });

// // 6. START SERVER
// httpServer.listen(PORT, () => {
//   console.log(`🚀 SmartStream Server running on http://localhost:${PORT}`);
// });