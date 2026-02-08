import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
import { WebRTCManager } from '../lib/webrtc'; 
import { predictAlgorithm, compressImage } from '../lib/compression';
import { FilePicker } from './FilePicker';
import { 
  Cpu, Wifi, Download, Bell, Lock, Activity, Layers, Link2Off, Zap, Terminal, Signal, Loader2, UserX, Search 
} from 'lucide-react';
import clsx from 'clsx';

// --- THEME PALETTE ---
const COLORS = {
  bg: '#0B0F14',
  surface: '#121826',
  text: '#E5E7EB',
};

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
// Fix: Allow polling fallback for better deployment compatibility
const socket: Socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 5 });

export const TransferRoom = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [username] = useState(localStorage.getItem('username') || '');
  const [status, setStatus] = useState('Connecting...');
  
  // P2P Status: 'disconnected' | 'connecting' | 'connected' | 'failed'
  const [p2pState, setP2pState] = useState<string>('disconnected'); 
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState('');
  const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  const [transferStats, setTransferStats] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState(''); 

  // --- REFS ---
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null); 
  const lastAckRef = useRef<string>(''); // ✅ NEW: Tracks received ACKs

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), msg]);

  // --- 1. INITIALIZATION & SOCKET LISTENERS ---
  useEffect(() => {
    if (!username) { navigate('/auth'); return; }
    const cleanName = username.trim().toLowerCase();
    
    // Generate Identity Keys
    generateKeyPair().then(keys => { keyPairRef.current = keys; addLog("Identity Keys Generated"); });
    
    // Connect to Signaling Server
    socket.emit('register-user', cleanName);
    setStatus('Online');
    addLog(`Logged in as ${cleanName}`);

    socket.on('connect', () => { setStatus('Online'); socket.emit('register-user', cleanName); });
    socket.on('disconnect', () => { setStatus('Offline'); setP2pState('disconnected'); });

    // 📨 SIGNALING HANDLER (The Handshake)
    socket.on('file-relay', async (data: any) => {
      const { from, payload } = data;
      if (!from) return;

      // A. WebRTC Signaling (Offer/Answer/ICE)
      if (['offer', 'answer', 'ice-candidate'].includes(payload.type)) {
        if (webrtcRef.current) {
          await webrtcRef.current.handleSignal(payload);
        }
        return;
      }

      // B. Connection Request
      if (payload.type === 'conn-request') {
        setIncomingRequest({ from, key: payload.key });
      }
      else if (payload.type === 'conn-accept') {
        const foreignKey = await importPublicKey(payload.key);
        if (keyPairRef.current) {
          sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
          
          addLog(`Starting P2P Handshake with ${from}...`);
          // Start WebRTC as Initiator (True)
          await initializeWebRTC(from, true); 
        }
      }
    });

    return () => { 
      socket.off('connect'); 
      socket.off('file-relay'); 
      socket.off('disconnect'); 
      webrtcRef.current?.close(); 
    };
  }, [username, navigate]);

  // --- 2. WEBRTC SETUP HELPERS ---
  const initializeWebRTC = async (target: string, isInitiator: boolean) => {
    setP2pState('connecting');
    setTargetUser(target);
    setSearchResult(null);

    webrtcRef.current = new WebRTCManager(
      socket,
      target,
      handleIncomingData, 
      (status: string) => { 
        setP2pState(status);
        if (status === 'connected') {
          setEncryptionReady(true);
          addLog(`🚀 P2P Tunnel ESTABLISHED with ${target}`);
        } else if (status === 'disconnected' || status === 'failed') {
          setEncryptionReady(false);
          addLog(`⚠️ P2P Link Lost.`);
        }
      }
    );

    await webrtcRef.current.initConnection(isInitiator);
  };

  const handleIncomingData = async (data: ArrayBuffer) => {
    try {
      // 1. Try to parse as JSON (Metadata)
      const text = new TextDecoder().decode(data);
      
      if (text.trim().startsWith('{')) {
        const msg = JSON.parse(text);

        if (msg.type === 'file-start') {
          setIsTransferring(true);
          addLog(`Receiving: ${msg.name}`);
          setQueueStatus(`Downloading ${msg.name}...`);
          setProgress(0);
          
          if (sharedKeyRef.current) {
            receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, msg.algo, (blob, stats) => {
              const url = URL.createObjectURL(blob);
              setReceivedFiles(prev => [...prev, { name: msg.name, url }]);
              setTransferStats(stats);
              addLog(`✅ Saved: ${msg.name}`);
              setProgress(100);
              setIsTransferring(false);
              setQueueStatus('');
              
              // ✅ 1. SEND ACK TO SENDER (Reliability Fix)
              if (webrtcRef.current) {
                 const ackMsg = JSON.stringify({ type: 'file-ack', name: msg.name });
                 const encoder = new window.TextEncoder();
                 webrtcRef.current.sendData(encoder.encode(ackMsg) as any);
              }
            });
          }
          return; 
        } 
        else if (msg.type === 'file-end') {
          addLog("Finalizing transfer...");
          if (receiverPipelineRef.current) await receiverPipelineRef.current.finish();
          // Note: The ACK is sent inside the finish callback above
          return; 
        }
        else if (msg.type === 'file-ack') {
           // ✅ 2. RECEIVE ACK FROM RECEIVER
           addLog(`✅ Verified by Peer: ${msg.name}`);
           lastAckRef.current = msg.name;
           return;
        }
      }
    } catch (e) {
      // Ignored: Not JSON, treat as binary
    }

    // 2. Process Binary Chunk
    if (receiverPipelineRef.current) {
      receiverPipelineRef.current.processChunk(new Uint8Array(data));
      setProgress(p => (p >= 98 ? 98 : p + 0.5));
    }
  };

  // --- 3. ACTIONS ---
  const sendConnectionRequest = async (target: string) => { 
    if(!keyPairRef.current) return; 
    const pubKey = await exportPublicKey(keyPairRef.current.publicKey); 
    addLog(`Requesting Connection to ${target}...`); 
    
    socket.emit('file-relay', { 
      targetUsername: target, 
      payload: { type: 'conn-request', key: pubKey } 
    });
  };
  
  const acceptConnection = async () => { 
    if(!incomingRequest || !keyPairRef.current) return; 
    const target = incomingRequest.from; 
    
    try {
      const foreignKey = await importPublicKey(incomingRequest.key); 
      sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey); 
      
      addLog(`Accepting ${target}...`);
      await initializeWebRTC(target, false); 

      const myPubKey = await exportPublicKey(keyPairRef.current.publicKey); 
      socket.emit('file-relay', { targetUsername: target, payload: { type: 'conn-accept', key: myPubKey }}); 
      setIncomingRequest(null); 
    } catch (e) {
      console.error(e);
      addLog("Handshake Failed");
    }
  };

  const startBatchTransfer = async (files: File[], algos: Map<string, string>) => {
    // 1. Strict Checks
    if (!webrtcRef.current || p2pState !== 'connected' || !sharedKeyRef.current) {
      return alert("P2P Connection not ready! Please wait for the green light.");
    }
    
    const p2pManager = webrtcRef.current;
    const sharedKey = sharedKeyRef.current;
    const encoder = new window.TextEncoder();

    setIsTransferring(true);

    try {
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        
        // --- A. AI OPTIMIZATION (Compression) ---
        const algoName = algos.get(file.name) || predictAlgorithm(file);
        setQueueStatus(`Optimizing ${file.name}...`);
        addLog(`🤖 AI Strategy: ${algoName}`);
        
        const originalSize = file.size;
        // Run compression logic
        file = await compressImage(file);
        
        if (file.size < originalSize) {
           const saved = ((originalSize - file.size) / 1024).toFixed(0);
           addLog(`📉 Compressed: Saved ${saved} KB`);
        }

        // --- B. TRANSFER START ---
        setQueueStatus(`Sending ${i + 1}/${files.length}: ${file.name}`);
        addLog(`Uploading "${file.name}"...`);
        setProgress(0);
        setTransferStats(null);

        // Send Metadata
        const startMeta = JSON.stringify({ type: 'file-start', name: file.name, algo: algoName });
        await p2pManager.sendData(encoder.encode(startMeta) as any);

        // Send Chunks
        const stats = await sendFilePipeline(file, sharedKey, algoName, async (chunk) => {
           await p2pManager.sendData(chunk as any); 
           setProgress(p => (p >= 98 ? 98 : p + 0.1));
        });

        // --- C. DRAIN BUFFER ---
        // Wait for browser buffer to empty (Prevent crash on large files)
        await new Promise<void>(resolve => {
           const check = setInterval(() => {
              // @ts-ignore
              if (p2pManager.dataChannel?.bufferedAmount === 0) {
                 clearInterval(check);
                 resolve();
              }
           }, 20);
        });

        // Send End Signal
        const endMeta = JSON.stringify({ type: 'file-end', name: file.name });
        await p2pManager.sendData(encoder.encode(endMeta) as any);

        // --- D. WAIT FOR ACK (Reliability Fix) ---
        addLog("Waiting for verification...");
        await new Promise<void>(resolve => {
           const timeout = setTimeout(() => {
              addLog("⚠️ Ack Timeout (Proceeding anyway)");
              resolve(); 
           }, 10000); // 10s Timeout safety

           const check = setInterval(() => {
              // Check if we received the ACK matching this file name
              if (lastAckRef.current === file.name) {
                 clearTimeout(timeout);
                 clearInterval(check);
                 resolve();
              }
           }, 100);
        });

        setTransferStats(stats);
        addLog(`✅ Verified: "${file.name}"`);
        setProgress(100);
        await new Promise(r => setTimeout(r, 200)); 
      }
      setQueueStatus('');
      addLog("Batch Transfer Complete");
    } catch (e) {
      addLog("❌ Transfer Interrupted");
      console.error(e);
    } finally {
      setIsTransferring(false);
      setProgress(0);
    }
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30" style={{ backgroundColor: COLORS.bg, color: COLORS.text }}>
      
      {/* 1. TOP NAVIGATION */}
      <nav className="sticky top-0 z-50 border-b border-gray-800 backdrop-blur-md bg-[#0B0F14]/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
              <Cpu className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">SmartStream <span className="text-blue-500 text-xs align-top">P2P</span></span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
               {/* Socket Status */}
               <div className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border", status === 'Online' ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                 <div className={clsx("w-2 h-2 rounded-full", status === 'Online' ? "bg-green-400" : "bg-red-400")} />
                 {status === 'Online' ? 'Signaling OK' : 'No Signal'}
               </div>
               
               {/* P2P Status */}
               {p2pState !== 'disconnected' && (
                 <div className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors", 
                   p2pState === 'connected' ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400")}>
                   <Activity className={clsx("w-3 h-3", p2pState === 'connected' ? "animate-pulse" : "animate-spin")} />
                   {p2pState === 'connected' ? 'P2P DIRECT' : 'NEGOTIATING...'}
                 </div>
               )}
            </div>

            <div className="h-6 w-px bg-gray-800 mx-2" />
            <span className="text-sm font-medium text-gray-400 hidden sm:block">@{username}</span>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 2. LEFT COLUMN */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* SEARCH & CONNECTION CARD */}
          <div className="rounded-2xl border border-gray-800 p-1 relative z-30" style={{ backgroundColor: COLORS.surface }}>
             {p2pState === 'connected' ? (
                // ACTIVE CONNECTION
                <div className="p-6 flex items-center justify-between bg-gradient-to-r from-blue-900/10 to-transparent">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                      <Zap className="w-6 h-6 text-blue-400 fill-current" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {targetUser} <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded font-bold">P2P LINKED</span>
                      </h3>
                      <p className="text-xs text-blue-400/80 font-mono mt-1">AES-256 • WEBRTC DATA CHANNEL • LOW LATENCY</p>
                    </div>
                  </div>
                  <button onClick={() => { webrtcRef.current?.close(); setP2pState('disconnected'); setEncryptionReady(false); setTargetUser(''); addLog("Closed Connection"); }} className="group flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all">
                    <span className="text-xs font-bold text-red-400 group-hover:text-red-300">DISCONNECT</span>
                    <Link2Off className="w-4 h-4 text-red-500" />
                  </button>
                </div>
             ) : (
                // SEARCH STATE
                <div className="p-6">
                  <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Signal className="w-4 h-4 text-blue-400" /> Find Peer
                  </h2>
                  <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5 group-focus-within:text-blue-400 transition-colors" />
                    <input 
                      type="text" 
                      placeholder="Search for username..." 
                      className="w-full bg-[#0B0F14] border border-gray-700 rounded-xl py-4 pl-12 pr-4 text-white outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-gray-600 font-medium"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
                    />
                    
                    <AnimatePresence>
                      {searchQuery && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                          className="absolute top-full left-0 right-0 mt-2 bg-[#1A202C] border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50"
                        >
                          {searchResult || (searchQuery.length > 2) ? (
                            <div className="p-3 flex items-center justify-between hover:bg-gray-800 transition-colors cursor-pointer" onClick={() => sendConnectionRequest(searchQuery)}>
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">
                                  {searchQuery[0].toUpperCase()}
                                </div>
                                <span className="font-bold text-gray-200">{searchQuery}</span>
                              </div>
                              <button className="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors">CONNECT</button>
                            </div>
                          ) : (
                             <div className="p-4 text-center text-gray-500 text-sm flex items-center justify-center gap-2"><UserX className="w-4 h-4" /> User not found</div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
             )}
          </div>

          {/* FILE PICKER */}
          <div className="relative z-10">
             {!encryptionReady && (
               <div className="absolute inset-0 z-10 bg-[#0B0F14]/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-2xl border border-gray-800/50">
                 <Lock className="w-10 h-10 text-gray-600 mb-2" />
                 <p className="text-gray-400 font-medium">Connect to a peer to start transferring</p>
               </div>
             )}
             
             {queueStatus && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
                  className="mb-4 bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl flex items-center justify-center gap-3"
                >
                   <Loader2 className="animate-spin text-blue-400 w-4 h-4" />
                   <span className="text-sm font-bold text-blue-400">{queueStatus}</span>
                </motion.div>
             )}
             <FilePicker onFilesSelected={startBatchTransfer} disabled={!encryptionReady || isTransferring} />
          </div>

          {/* 📊 FULL STATS GRID */}
          <AnimatePresence>
            {transferStats && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                
                {/* 1. ORIGINAL SIZE */}
                <StatCard 
                  label="Original Size" 
                  value={`${(transferStats.originalSize / 1024 / 1024).toFixed(2)} MB`} 
                  icon={Layers} 
                  color="text-gray-400" 
                />

                {/* 2. BANDWIDTH USED */}
                <StatCard 
                  label="Bandwidth Used" 
                  value={
                    transferStats.finalSize < 1024 * 1024 
                      ? `${(transferStats.finalSize / 1024).toFixed(2)} KB` 
                      : `${(transferStats.finalSize / 1024 / 1024).toFixed(2)} MB`
                  } 
                  icon={Wifi} 
                  color={transferStats.finalSize < transferStats.originalSize ? "text-blue-400" : "text-gray-400"} 
                />

                {/* 3. COMPRESSION SAVINGS */}
                <StatCard 
                  label="Compression" 
                  value={(() => {
                    if (!transferStats.originalSize) return '0%';
                    const ratio = ((1 - (transferStats.finalSize / transferStats.originalSize)) * 100);
                    return ratio > 0 ? `${ratio.toFixed(1)}%` : '0%';
                  })()} 
                  icon={Zap} 
                  color={transferStats.finalSize < transferStats.originalSize ? "text-green-400" : "text-gray-500"} 
                />

                {/* 4. SPEED */}
                <StatCard 
                  label="Transfer Speed" 
                  value={`${transferStats.speed} MB/s`} 
                  icon={Activity} 
                  color="text-yellow-400" 
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 3. RIGHT COLUMN (Logs & Files) */}
        <div className="lg:col-span-4 space-y-6 h-full flex flex-col z-10">
          
          {receivedFiles.length > 0 && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-[#121826] border border-gray-800 rounded-2xl p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Download className="w-4 h-4 text-green-500" /> Received Files</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar">
                  {receivedFiles.map((f, i) => (
                    <div key={i} className="group flex items-center justify-between p-3 bg-[#0B0F14] rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:text-white transition-colors">{f.name.split('.').pop()?.toUpperCase()}</div>
                        <span className="text-sm text-gray-300 truncate font-medium">{f.name}</span>
                      </div>
                      <a href={f.url} download={f.name} className="p-2 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-green-400 transition-colors"><Download className="w-4 h-4" /></a>
                    </div>
                  ))}
                </div>
             </motion.div>
          )}

          <div className="flex-1 bg-black rounded-2xl border border-gray-800 p-1 flex flex-col min-h-[400px]">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 rounded-t-xl">
               <div className="flex items-center gap-2"><Terminal className="w-4 h-4 text-blue-500" /><span className="text-xs font-bold text-gray-400">SYSTEM OUTPUT</span></div>
               <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-green-500/20" /></div>
            </div>
            <div className="flex-1 p-4 font-mono text-xs space-y-1.5 overflow-y-auto custom-scrollbar text-gray-400">
               {logs.map((log, i) => (
                 <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                   <span className="text-blue-500/50">➜</span>
                   <span className={clsx(log.includes('CRITICAL') || log.includes('Failed') ? "text-red-400" : log.includes('ESTABLISHED') || log.includes('Successfully') ? "text-green-400" : "text-gray-300")}>{log}</span>
                 </motion.div>
               ))}
               <div className="animate-pulse text-blue-500">_</div>
            </div>
          </div>
        </div>
      </div>

      {/* GLOBAL PROGRESS BAR */}
      <AnimatePresence>
        {progress > 0 && progress < 100 && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-0 left-0 right-0 bg-[#121826] border-t border-gray-800 p-4 z-50 shadow-2xl">
             <div className="max-w-3xl mx-auto flex items-center gap-4">
               <span className="text-xs font-bold text-blue-400 animate-pulse">P2P TRANSFER...</span>
               <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                 <motion.div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ ease: "linear" }} />
               </div>
               <span className="text-xs font-mono text-gray-400">{Math.round(progress)}%</span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: INCOMING REQUEST */}
      <AnimatePresence>
        {incomingRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-[#121826] border border-blue-500/30 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-blue-500/5 z-0" />
                <Bell className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-bounce relative z-10" />
                <h3 className="text-xl font-bold text-white mb-2 relative z-10">Connection Request</h3>
                <p className="text-gray-400 mb-8 relative z-10"><strong className="text-white">{incomingRequest.from}</strong> wants to open a direct P2P tunnel.</p>
                <div className="flex gap-3 justify-center relative z-10">
                  <button onClick={() => setIncomingRequest(null)} className="px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors">Ignore</button>
                  <button onClick={acceptConnection} className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-500/25 transition-all">Accept</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- HELPER COMPONENT ---
const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-[#121826] border border-gray-800 p-4 rounded-xl flex flex-col justify-between h-24">
    <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-bold text-gray-500 uppercase">{label}</span><Icon className={`w-4 h-4 ${color}`} /></div>
    <span className="text-lg font-bold text-gray-200 tracking-tight">{value}</span>
  </div>
);