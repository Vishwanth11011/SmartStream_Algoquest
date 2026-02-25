# 🚀 SmartStream — Project Role Distribution

> **Project:** SmartStream · AlgoQuest 2025  
> **Stack:** React + TypeScript (Client) · Node.js + Socket.IO (Server) · MongoDB Atlas (DB)  
> **Purpose:** A peer-to-peer secure file relay network with AES-256 encryption, heuristic compression, malware scanning, and WebRTC mesh networking.

---

## 📌 Project Architecture Overview

```
SmartStream-Project/
├── client/src/
│   ├── pages/         Auth.tsx                  ← Login / Register UI
│   ├── components/    TransferRoom.tsx           ← Core P2P Room UI (1346 lines)
│   │                  FilePicker.tsx             ← File selection component
│   │                  TransferProgressStages.tsx ← Progress display UI
│   └── lib/
│       ├── auth.ts         ← API calls (login, register, password reset)
│       ├── webrtc.ts       ← RTCPeerConnection + DataChannel manager
│       ├── p2p.ts          ← PeerJS-based P2P + Socket.IO signaling
│       ├── crypto.ts       ← ECDH key exchange + AES-GCM encrypt/decrypt
│       ├── pipeline.ts     ← Send/Receive streaming pipelines
│       ├── compression.ts  ← Decision-tree compression + security scan
│       ├── ai.ts           ← Entropy-based AI compression recommender
│       └── stats.ts        ← Compression metrics calculator
└── server/src/
    └── server.ts           ← Express REST API + Socket.IO signaling + MongoDB
```

---

## 👥 Contributor Role Distribution

> Each member owns **2 closely related topics** with approximately equal code responsibility. Functions listed are the primary ones each member is accountable for understanding, implementing, and documenting.

---

### 👤 Member 1 — Authentication & Server Signaling / Database - Tejavardhan and varshith

**Topics:** User Login · Server Signaling & DB

| File | Function / Route | Description |
|------|-----------------|-------------|
| `server/src/server.ts` | `POST /api/auth/register` | Validates, hashes password & security answer, saves user to MongoDB |
| `server/src/server.ts` | `POST /api/auth/login` | Authenticates user, returns JWT token |
| `server/src/server.ts` | `GET /api/auth/security-question/:username` | Fetches security question for password recovery |
| `server/src/server.ts` | `POST /api/auth/reset-password` | Verifies security answer, resets bcrypt-hashed password |
| `server/src/server.ts` | `connectDB()` | Connects server to MongoDB Atlas via MONGO_URI |
| `server/src/server.ts` | `socket.on('register-user')` | Maps username → socket ID for global presence |
| `server/src/server.ts` | `socket.on('disconnect')` | Cleans up user from global map and room list on disconnect |
| `server/src/server.ts` | `GET /api/users` | Returns all currently online users |
| `client/src/lib/auth.ts` | `loginUser()` | Sends login API request with credentials |
| `client/src/lib/auth.ts` | `registerUser()` | Sends registration API request |
| `client/src/lib/auth.ts` | `fetchSecurityQuestion()` | Gets security question for forgot-password flow |
| `client/src/lib/auth.ts` | `resetPassword()` | Submits answer + new password for reset |
| `client/src/pages/Auth.tsx` | `handleAuthAction()` | Main form handler for login / register / forgot-password flow |
| `server/prisma/schema.prisma` | `User` model | Username, email, password, securityQuestion, securityAnswer fields |
| `server/prisma/schema.prisma` | `TransferHistory` model | Logs file transfers with size, compression algo, sender/receiver |

---

### 👤 Member 2 — WebRTC Connection Protocols & Transfer Pipeline Configuration - Lalith and Vishwanth

**Topics:** WebRTC Connection Protocols · Transfer Pipeline Configuration

| File | Function / Method | Description |
|------|------------------|-------------|
| `client/src/lib/webrtc.ts` | `WebRTCManager` (constructor) | Creates RTCPeerConnection with STUN servers, sets up ICE batching |
| `client/src/lib/webrtc.ts` | `initConnection(isInitiator)` | Creates data channel (initiator) or waits for offer; negotiates SDP |
| `client/src/lib/webrtc.ts` | `handleSignal(payload)` | Processes incoming offer / answer / ICE-candidate signals |
| `client/src/lib/webrtc.ts` | `processSignalQueue()` | Drains queued ICE candidates after remote description is set (race-condition fix) |
| `client/src/lib/webrtc.ts` | `setupDataChannel(channel)` | Configures binary type, backpressure threshold, message/open/close handlers |
| `client/src/lib/webrtc.ts` | `sendData(data)` | Event-driven backpressure send — waits on `bufferedAmountLow` if buffer > 1 MB |
| `client/src/lib/webrtc.ts` | `enableTurboMode()` | Opens 3 extra parallel data channels for high-throughput transfers |
| `client/src/lib/webrtc.ts` | `setBufferParams(limit, threshold)` | Dynamically tunes buffer limit and low-threshold for flow control |
| `client/src/lib/webrtc.ts` | `close()` | Gracefully closes all turbo channels and the peer connection |
| `client/src/lib/pipeline.ts` | `sendFilePipeline()` | Streams a Blob through TransformStream; chunks → `encryptChunk` → `onChunk` callback |
| `client/src/lib/pipeline.ts` | `ReceiverPipeline.processChunk()` | Queues decryption of each incoming ArrayBuffer chunk |
| `client/src/lib/pipeline.ts` | `ReceiverPipeline.finish()` | Awaits full processing queue, assembles Blob from decrypted chunks, emits stats |

---

### 👤 Member 3 — Mesh Network (Room Feature) & UI Maintenance - Abhiram and Lalith

**Topics:** Mesh Network (Room Feature) · UI Maintenance

| File | Function / Method | Description |
|------|------------------|-------------|
| `server/src/server.ts` | `socket.on('join-room')` | Adds user to a room, broadcasts `user-joined` to peers, sends `existing-users` to newcomer |
| `server/src/server.ts` | `socket.on('signal')` | Targeted signal relay enabling per-peer WebRTC handshakes in the mesh |
| `server/src/server.ts` | `socket.on('leave-room')` | Removes user, notifies peers, cleans up empty rooms |
| `server/src/server.ts` | `socket.on('invite-user')` | Sends room invitation to a specific online user |
| `server/src/server.ts` | `socket.on('check-room')` | Tells client whether a room ID currently exists |
| `server/src/server.ts` | `socket.on('sync-room-users')` | Returns full user list of a room for state reconciliation |
| `server/src/server.ts` | `socket.on('connection-request')` & `connection-accept` | Relays direct connection handshake between users |
| `client/src/components/TransferRoom.tsx` | `handleCreateRoom()` | Generates a random 6-char room ID and emits `join-room` |
| `client/src/components/TransferRoom.tsx` | `handleJoinRoom()` | Validates room ID and emits `join-room` to server |
| `client/src/components/TransferRoom.tsx` | `handleLeaveRoom()` | Emits `leave-room`, closes all WebRTC managers, resets state |
| `client/src/components/TransferRoom.tsx` | `handleDirectConnect()` | Initiates 1-on-1 WebRTC handshake to a peer by socket ID |
| `client/src/components/TransferRoom.tsx` | `acceptRequest()` | Handles incoming connection request and begins WebRTC handshake as answerer |
| `client/src/components/TransferRoom.tsx` | `generateRoomId()` | Generates a unique 6-character alphanumeric room code |
| `client/src/components/TransferRoom.tsx` | `StatCard` component | 3D styled performance stat card (speed, ratio, saved bytes) |
| `client/src/components/TransferProgressStages.tsx` | Full component | Visual step-by-step pipeline progress display (Scan → Compress → Encrypt → Transfer) |
| `client/src/components/FilePicker.tsx` | Full component | Drag-and-drop / click file selection with file type icons and preview |

---

### 👤 Member 4 — Security Scan & AES Encryption - Abhiram and vishwanth

**Topics:** Security Scan · AES Encryption

| File | Function | Description |
|------|----------|-------------|
| `client/src/lib/compression.ts` | `calculateEntropy(data)` | Shannon entropy calculation (0–8 bits) — detects encrypted/packed data |
| `client/src/lib/compression.ts` | `detectCompressionFamily(header)` | Magic-number based file family classifier (DEFLATE, LZMA, ZSTD, DCT, LZW, Audio, Text) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 1 | Blocks dangerous executable extensions (.exe, .dll, .sh, .bat, .js, .ipa, etc.) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 2 | File type mismatch detection (e.g., .exe header in a .txt file) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 3 | Abnormal entropy guard for text/code files (packed malware detection) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 4 | Ransomware threshold check (entropy > 7.9 in .txt/.json/.js/.ipynb) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 5 | Double extension detection (e.g., `invoice.pdf.exe`) |
| `client/src/lib/compression.ts` | `processFile()` — Security Check 6 | Script injection pattern scan (`<script>`, `eval()`, `WScript.Shell`, etc.) |
| `client/src/lib/crypto.ts` | `generateKeyPair()` | Generates ECDH P-256 key pair for Diffie-Hellman handshake |
| `client/src/lib/crypto.ts` | `exportPublicKey()` | Exports public key to JWK format for transmission over data channel |
| `client/src/lib/crypto.ts` | `importPublicKey()` | Imports peer's JWK public key for shared secret derivation |
| `client/src/lib/crypto.ts` | `deriveSharedKey()` | Derives AES-GCM-256 shared key from own private + peer's public key (ECDH) |
| `client/src/lib/crypto.ts` | `encryptChunk(key, chunk)` | AES-GCM encrypts a Uint8Array chunk; prepends 12-byte random IV |
| `client/src/lib/crypto.ts` | `decryptChunk(key, data)` | Extracts IV (first 12 bytes), AES-GCM decrypts ciphertext |
| `client/src/components/TransferRoom.tsx` | `handleIncomingData()` (crypto handshake section) | Manages ECDH key exchange over the data channel before file transfer begins |

---

### 👤 Member 5 — Decision Tree Compression & File Uploading - Tejavardhan and varshith

**Topics:** Decision Tree Based Compression · File Uploading

| File | Function | Description |
|------|----------|-------------|
| `client/src/lib/ai.ts` | `calculateFeatures(data)` | Computes Shannon entropy from a 16 KB file sample |
| `client/src/lib/ai.ts` | `analyzeFile(file)` | Decision-tree AI recommender: entropy < 6.0 → Deflate, else → Gzip |
| `client/src/lib/compression.ts` | `processFile()` — Strategy 1 | TEXT_DATA / .json / .js / .ipynb → `deflateSync` at level 9 (ultra) |
| `client/src/lib/compression.ts` | `processFile()` — Strategy 2 | All other types (images, video, binary) → `gzipSync` at level 6 |
| `client/src/lib/compression.ts` | `processFile()` — ZIP Exemption | Skips compression for `.zip` files to avoid double-wrap overhead |
| `client/src/lib/stats.ts` | `calculateCompressionPercent()` | `(1 - compressed/original) × 100` |
| `client/src/lib/stats.ts` | `calculateCompressionRatio()` | `original / compressed` (e.g., 2:1) |
| `client/src/lib/stats.ts` | `calculateSpaceSaved()` | Bytes saved = original − compressed |
| `client/src/lib/stats.ts` | `getCompressionStats()` | Aggregates all 3 metrics into a single `CompressionStats` object |
| `client/src/components/TransferRoom.tsx` | `startBatchTransfer(files)` | Orchestrates multi-file transfer: scan → compress → encrypt → chunk-send per peer |
| `client/src/components/TransferRoom.tsx` | `isPeerReady(peerId, manager)` | Checks if a peer's data channel is open before sending |
| `client/src/components/TransferRoom.tsx` | `decompressBlob(blob, algo, fileName)` | Receiver-side robust decompression using browser DecompressionStream (Gzip / Deflate) |
| `client/src/components/TransferRoom.tsx` | `handleIncomingData()` (file reassembly) | Accumulates chunks, triggers `ReceiverPipeline.finish()` on END signal, initiates download |
| `client/src/components/FilePicker.tsx` | Full component | UI for selecting / dragging files before invoking `startBatchTransfer` |

---

## 📊 Contribution Balance Summary

| Member | Topics | Approx. Functions | Key Files |
|--------|--------|:-----------------:|-----------|
| **Member 1** | User Login · Server Signaling & DB | ~14 | `server.ts`, `auth.ts`, `Auth.tsx`, `schema.prisma` |
| **Member 2** | WebRTC Protocols · Transfer Pipeline | ~12 | `webrtc.ts`, `pipeline.ts` |
| **Member 3** | Mesh Network · UI Maintenance | ~15 | `TransferRoom.tsx` (room logic), `TransferProgressStages.tsx`, `FilePicker.tsx` |
| **Member 4** | Security Scan · AES Encryption | ~14 | `compression.ts` (security), `crypto.ts` |
| **Member 5** | Decision Tree Compression · File Upload | ~13 | `ai.ts`, `compression.ts` (strategies), `stats.ts`, `TransferRoom.tsx` (transfer engine) |

---

## 🔗 Inter-Module Data Flow

```
Auth.tsx → auth.ts → server.ts (REST)
                          ↓
                   MongoDB (User / TransferHistory)

TransferRoom.tsx
  ├── socket.io ←→ server.ts (Signaling)
  │        join-room / signal / leave-room / invite-user
  ├── webrtc.ts (RTCPeerConnection)
  │        initConnection → handleSignal → setupDataChannel
  ├── p2p.ts (PeerJS overlay — alternative path)
  │
  ├── [SEND PATH]
  │     FilePicker.tsx → analyzeFile (ai.ts) → processFile (compression.ts)
  │         → sendFilePipeline (pipeline.ts) → encryptChunk (crypto.ts)
  │         → WebRTCManager.sendData()
  │
  └── [RECEIVE PATH]
        handleIncomingData() → ReceiverPipeline.processChunk()
            → decryptChunk (crypto.ts) → ReceiverPipeline.finish()
            → decompressBlob() → file download
```

---

*Generated: February 2026 · SmartStream Project · AlgoQuest 2025*
