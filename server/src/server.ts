import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Debug endpoint: List all registered users
app.get('/api/users', (req, res) => {
  const users = Array.from(userRegistry.entries()).map(([username, { peerId }]) => ({
    username,
    peerId,
    registered: true
  }));
  res.json({ users, count: users.length });
});

app.get('/debug/registry', (req, res) => {
  const users = Array.from(userRegistry.entries()).map(([username, { socketId, peerId }]) => ({
    username,
    socketId,
    peerId
  }));
  res.json({ users, count: users.length, timestamp: new Date().toISOString() });
});

// Socket.io - Signaling Server for WebRTC
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8, // ⚠️ ADD THIS: Increase limit to 100MB
  pingTimeout: 60000,     // ⚠️ ADD THIS: Allow slower connections
});

// Map username -> {socketId, peerId}
const userRegistry = new Map<string, { socketId: string; peerId: string }>();

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // 1. User registers with a username and PeerJS ID
  socket.on('register-user', (username: string, peerId: string) => {
    console.log(`📝 Registering ${username} with PeerJS ID: ${peerId}`);
    userRegistry.set(username, { socketId: socket.id, peerId });
    socket.emit('register-success', peerId);
    io.emit('user-online', { username, peerId }); // Broadcast to all clients
  });

  // 2. User queries for a target user
  socket.on('get-user', (targetUsername: string, callback) => {
    const user = userRegistry.get(targetUsername);
    const registeredUsers = Array.from(userRegistry.keys());
    
    if (user) {
      console.log(`✅ [LOOKUP SUCCESS] Found "${targetUsername}" -> Peer ID: ${user.peerId}`);
      callback({ found: true, peerId: user.peerId });
    } else {
      console.log(`⚠️  [LOOKUP FAILED] Searched for "${targetUsername}"`);
      console.log(`    Registered users: ${registeredUsers.length > 0 ? registeredUsers.join(', ') : '(none)'}`);
      callback({ found: false, error: 'User not online' });
    }
  });

  socket.on('file-relay', (data) => {
    const { targetUsername, payload } = data;
    
    // Find the recipient
    const targetUser = userRegistry.get(targetUsername);
    if (targetUser) {
      // Forward the data immediately to the target
      io.to(targetUser.socketId).emit('file-relay', {
        from: userRegistry.get(data.username)?.username,
        payload // This contains the file chunk or key
      });
    }
  });


  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    for (const [username, user] of userRegistry.entries()) {
      if (user.socketId === socket.id) {
        userRegistry.delete(username);
        io.emit('user-offline', { username });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 SmartStream Server running on port ${PORT}`);
});