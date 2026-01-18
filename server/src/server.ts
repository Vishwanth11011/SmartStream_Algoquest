// server/server.ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8 // 100MB Limit (Crucial for large files)
});

// User Registry: Maps Socket ID -> Username
const userRegistry = new Map<string, string>();

io.on('connection', (socket) => {
  console.log(`🔌 New Client: ${socket.id}`);

  // 1. Register User
  socket.on('register-user', (username: string) => {
    userRegistry.set(socket.id, username);
    console.log(`✅ Registered: ${username} (${socket.id})`);
    io.emit('user-online', { users: Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name })) });
  });

  // 2. The Relay (Heart of the App)
  socket.on('file-relay', (data) => {
    const { targetUsername, payload } = data;
    
    // Find target socket ID
    const targetEntry = Array.from(userRegistry.entries()).find(([id, name]) => name === targetUsername);
    
    if (targetEntry) {
      const [targetSocketId, _] = targetEntry;
      const senderName = userRegistry.get(socket.id); // Get Sender Name

      // ⚠️ CRITICAL FIX: Attach 'from' username so Receiver knows who sent it
      io.to(targetSocketId).emit('file-relay', {
        from: senderName, 
        payload: payload
      });
    } else {
      console.warn(`⚠️ Delivery failed. User ${targetUsername} not found.`);
    }
  });

  // 3. Cleanup
  socket.on('disconnect', () => {
    userRegistry.delete(socket.id);
    io.emit('user-online', { users: Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name })) });
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// API for User List Polling
app.get('/api/users', (req, res) => {
  const users = Array.from(userRegistry.entries()).map(([id, name]) => ({ socketId: id, username: name }));
  res.json({ users });
});

httpServer.listen(3001, () => {
  console.log('🚀 Server running on http://localhost:3001');
});