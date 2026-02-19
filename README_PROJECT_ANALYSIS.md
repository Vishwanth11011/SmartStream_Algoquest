# 🚀 SmartStream: Secure Mesh File Transfer System

## 🌟 Project Overview
SmartStream is a high-performance, secure, and bandwidth-efficient file transfer application designed for modern web environments. It leverages **WebRTC** for peer-to-peer (P2P) mesh networking, **End-to-End Encryption (E2EE)** for security, and **Intelligent Heuristic Compression** to optimize transfer speeds.

Unlike traditional file transfer tools, SmartStream includes a "Security Layer" that analyzes file structures (entropy, magic headers) to detect and block potential malware *before* it leaves the sender's device.

---

## 🧠 Core Logics & Logic Flow

### 1. Intelligent Compression Strategy
The system does not blindly compress every file. It uses a **Heuristic Processor** (`client/src/lib/compression.ts`) to decide the best strategy:
- **Text/Code (JSON, JS, TXT, XML)**: High-ratio **Deflate (Level 9)** compression. These files compress extremely well (up to 90%).
- **Media/Binary (Images, Videos, Archives)**: Standard **Gzip (Level 6)**. While these are often already compressed, Gzip adds a compatibility wrapper without significant CPU overhead.
- **Analysis**: Calculates **Shannon Entropy** (0.0 - 8.0) to measure randomness. Low entropy = high compressibility. High entropy = low compressibility.

### 2. Security & Encryption Layer
- **Pre-Transfer Scanning**: Before a file is touched by the network pipeline, it undergoes a security check:
    - **Extension Spoofing**: Checks if a `.txt` file actually has a binary header (e.g., `MZ` for .exe).
    - **Double Extensions**: Flags suspicious names like `document.pdf.exe`.
    - **Script Injection**: Scans HTML/Text files for malicious patterns (`<script>`, `eval()`).
    - **Abnormal Entropy**: High entropy in text files triggers a "Ransomware/Encrypted Payload" alert.
- **Transmission Security**:
    - **Key Exchange**: Uses **ECDH (Elliptic Curve Diffie-Hellman)**. Peers exchange public keys via the signaling server to derive a shared secret *without* the server ever knowing it.
    - **Payload Encryption**: Every file chunk (128KB) is encrypted using **AES-256-GCM** with a unique Initialization Vector (IV).

### 3. Mesh & Multi-Protocol Transfer
- **Signaling Server**: A WebSocket (Socket.IO) server acts as a matchmaker to help peers find each other and exchange SDP (Session Description Protocol) packets.
- **WebRTC Data Channels**: Once connected, data flows directly between peers (P2P), bypassing the server to save bandwidth and ensure privacy.
- **Mesh Broadcast**: When sending to a room, the sender iterates through all connected peers (`activePeers`) and streams the data to each one sequentially or in parallel depending on the pipeline state.

---

## 📂 File Structure & Responsibilities

### 🖥️ Client (`/client/src`)

#### **Core Libraries (`/lib`)** - *The Brains*
| File | Role & Key Functions |
|------|----------------------|
| **`compression.ts`** | **The Optimizer.** <br> • `processFile()`: Main entry. Reads file signature, calculates entropy, runs security checks, and compresses data.<br> • `detectCompressionFamily()`: Identifies file types by "Magic Numbers" (hex headers).<br> • `calculateEntropy()`: Math utility to measure data randomness. |
| **`crypto.ts`** | **The Vault.** <br> • `generateKeyPair()`: Creates local ECDH keys.<br> • `deriveSharedKey()`: Combines local Private Key + Peer Public Key to make a Shared Secret.<br> • `encryptChunk() / decryptChunk()`: AES-GCM transformations for stream chunks. |
| **`pipeline.ts`** | **The Engine.** <br> • `sendFilePipeline()`: Uses `TransformStream` to chunk, encrypt, and push data to WebRTC.<br> • `ReceiverPipeline`: Class that receives raw encrypted chunks, decrypts them, reassembles the Blob, and triggers the download. |
| **`webrtc.ts`** | **The Network Layer.** <br> • `WebRTCManager`: Wrapper for `RTCPeerConnection`. Handles ICE candidates and Data Channel lifecycle.<br> • `sendData()`: Smart sender that monitors `bufferedAmount` to prevent browser crashes (Backpressure). |
| **`ai.ts`** | **The Analyst.** <br> • `analyzeFile()`: Used by the UI to show "AI Analysis" stats (Entropy Score, Vector) before transfer. |
| **`stats.ts`** | **The Metrics.** <br> • Utilities to calculate Compression Ratio (e.g., "2.5:1") and Space Saved. |

#### **Components (`/components`)** - *The Body*
| File | Role & Key Functions |
|------|----------------------|
| **`TransferRoom.tsx`** | **The Command Center.** <br> • Manages Socket.IO connection and Room state.<br> • Discover peers (`createPeerConnection`).<br> • Orchestrates the entire flow: `startBatchTransfer` loops through files → calls `compression` → calls `pipeline` → sends via `webrtc`. |
| **`FilePicker.tsx`** | **The Input.** <br> • Handles file selection (Drag & Drop).<br> • Triggers initial AI analysis to show the "Entropy" animation. |
| **`TransferProgressStages.tsx`** | **The Display.** <br> • Visualizes the 5 steps: Algo Selection → Compression → Encryption → Transfer → Decryption. |

---

### ⚙️ Server (`/server/src`)

#### **Core Server Files**
| File | Role & Key Functions |
|------|----------------------|
| **`server.ts`** | **The Traffic Cop.** <br> • Initializes Express App & Socket.IO.<br> • **Signaling**: Relays `offer`, `answer`, and `ice-candidate` packets between peers.<br> • **Rooms**: Manages `join-room`, `user-joined`, and list of peers in a mesh. |
| **`models/User.ts`** | **Database Schema.** <br> • Defines User structure (username, password hash, security questions) for MongoDB. |

#### **Controllers & Util**
| File | Role & Key Functions |
|------|----------------------|
| **`controllers/authController.ts`** | **Gatekeeper.** <br> • `register()`: Hashes password/answers with bcrypt.<br> • `login()`: Issues JWT tokens.<br> • `resetPassword()`: Verifies security answers. |
| **`utils/stats.ts`** | Shared logic for compression stats (mirrors client logic for consistency). |

---

## 🔒 Security Summary
1.  **Transport**: WebRTC (DTLS) + Custom AES-256 E2E Layer.
2.  **Authentication**: JWT (JSON Web Tokens) for API access.
3.  **Malware Defense**:
    -   Signature Verification (prevents extension spoofing).
    -   Heuristic Entropy Analysis (detects packed/encrypted malware).
    -   Script Logic Scanning.

## 🚀 Performance Optimization
-   **Backpressure Handling**: `webrtc.ts` pauses transmission if the network buffer fills up (`bufferedAmount`), preventing memory crashes on large file transfers (1GB+).
-   **Parallel/Sequential Streams**: The `pipeline.ts` uses streams (Streams API), ensuring that the file is not loaded entirely into RAM. It is processed in small, manageable chunks.
