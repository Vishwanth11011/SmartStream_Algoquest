import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
import { FilePicker } from './FilePicker';
import { Cpu, Wifi, Download, Bell, Lock, Activity, Clock, Layers, UserCircle, LogOut, Search, UserX, UserCheck, Link2Off } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket: Socket = io(SERVER_URL, { transports: ['websocket'], reconnectionAttempts: 5 });

export const TransferRoom = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [username, setUsername] = useState(localStorage.getItem('username') || '');
  const [status, setStatus] = useState('Connecting...');
  
  // Search & Peers
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);

  // Connection
  const [targetUser, setTargetUser] = useState('');
  const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  
  // Transfer & Safety
  const [isTransferring, setIsTransferring] = useState(false); // 🛡️ Safety Lock
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  const [transferStats, setTransferStats] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState(''); 

  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), msg]);

  // --- 1. INITIALIZATION & SOCKET LOGIC ---
  useEffect(() => {
    if (!username) { navigate('/auth'); return; }

    const cleanName = username.trim().toLowerCase();

    generateKeyPair().then(keys => { keyPairRef.current = keys; addLog("🔐 ID Keys Generated"); });

    socket.emit('register-user', cleanName);
    setStatus('🟢 Online');
    addLog(`✅ Logged in as ${cleanName}`);

    socket.on('connect', () => { setStatus('🟢 Online'); socket.emit('register-user', cleanName); });
    socket.on('disconnect', () => { setStatus('🔴 Offline'); });

    // --- RECEIVER LOGIC ---
    socket.on('file-relay', async (data: any, ackCallback: Function) => {
      const { from, payload } = data;
      if (!from) return;

      if (payload.type === 'conn-request') {
        setIncomingRequest({ from, key: payload.key });
      }
      else if (payload.type === 'conn-accept') {
        const foreignKey = await importPublicKey(payload.key);
        if (keyPairRef.current) {
          sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
          setEncryptionReady(true);
          setTargetUser(from);
          setSearchResult(null); 
          setSearchQuery('');
          addLog(`✅ Secure Link Established with ${from}`);
        }
      }
      else if (payload.type === 'file-start') {
        setIsTransferring(true); // 🔒 Lock Receiver
        const algo = payload.algo || 'None';
        addLog(`📥 Receiving: ${payload.name}`);
        setProgress(0);
        setTransferStats(null);

        if (sharedKeyRef.current) {
          receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, algo, (blob, stats) => {
            const url = URL.createObjectURL(blob);
            setReceivedFiles(prev => [...prev, { name: payload.name, url }]);
            setTransferStats(stats);
            addLog("✅ File Downloaded Successfully!");
            setProgress(100);
            setIsTransferring(false); // 🔓 Unlock
          });
        }
      }
      else if (payload.type === 'file-chunk') {
        if (receiverPipelineRef.current) {
          receiverPipelineRef.current.processChunk(new Uint8Array(payload.chunk));
          setProgress(p => (p >= 95 ? 95 : p + 1));
          if (ackCallback) ackCallback("ACK"); // Send Ack
        }
      }
      else if (payload.type === 'file-end') {
        addLog("⚙️ Finalizing...");
        if (receiverPipelineRef.current) await receiverPipelineRef.current.finish();
        setIsTransferring(false); // 🔓 Unlock
      }
    });

    return () => { socket.off('connect'); socket.off('file-relay'); socket.off('disconnect'); };
  }, [username, navigate]);

  // --- 2. WATCHDOG: POLLING & DISCONNECT ALERT (Every 2s) ---
  useEffect(() => { 
    const i = setInterval(async () => { 
      try { 
        const res = await fetch(`${SERVER_URL}/api/users`); 
        const d = await res.json(); 
        const latestUsers = d.users.map((u:any) => u.username);
        setOnlineUsers(latestUsers);

        // Search Update
        if (searchQuery) {
          if (latestUsers.includes(searchQuery) && searchQuery !== username) {
            setSearchResult(searchQuery);
          } else {
            setSearchResult(null);
          }
        }

        // 🚨 CONNECTION LOST ALERT
        if (encryptionReady && targetUser) {
          if (!latestUsers.includes(targetUser)) {
            addLog(`❌ CRITICAL: ${targetUser} Disconnected!`);
            setQueueStatus(`⚠️ CONNECTION LOST: ${targetUser} went offline.`);
            
            // Browser Notification
            if (Notification.permission === "granted") {
              new Notification("SmartStream Connection Lost", { body: `${targetUser} has disconnected.` });
            } else if (Notification.permission !== "denied") {
              Notification.requestPermission();
            }

            setEncryptionReady(false);
            setTargetUser('');
            setTransferStats(null);
          }
        }
      } catch(e){} 
    }, 2000); 
    return () => clearInterval(i); 
  }, [searchQuery, username, encryptionReady, targetUser]);

  // --- 3. SAFETY LOCK: PREVENT RELOAD ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTransferring) {
        e.preventDefault();
        e.returnValue = "Transfer in progress!"; 
        return "Transfer in progress!";
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isTransferring]);

  // --- ACTIONS ---
  const handleLogout = () => {
    if (isTransferring && !confirm("Transfer in progress! Logout anyway?")) return;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    socket.disconnect();
    navigate('/auth');
  };

  const sendConnectionRequest = async (target: string) => { 
    if(!keyPairRef.current) return; 
    const pubKey = await exportPublicKey(keyPairRef.current.publicKey); 
    addLog(`📡 Requesting Connection to ${target}...`); 
    
    // Send Request & Wait for Server Ack/Error
    socket.emit('file-relay', { 
      targetUsername: target, 
      payload: { type: 'conn-request', key: pubKey } 
    }, (response: any) => {
      if (response && response.error) {
        alert(`❌ Connection Failed: ${response.error}`);
        addLog(`❌ Failed: ${response.error}`);
        setSearchResult(null);
      } else {
        addLog(`⏳ Waiting for ${target} to accept...`);
      }
    });
  };
  
  const acceptConnection = async () => { 
    if(!incomingRequest || !keyPairRef.current) return; 
    const target = incomingRequest.from; 
    const foreignKey = await importPublicKey(incomingRequest.key); 
    sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey); 
    setEncryptionReady(true); 
    setTargetUser(target); 
    setIncomingRequest(null); 
    const myPubKey = await exportPublicKey(keyPairRef.current.publicKey); 
    socket.emit('file-relay', { targetUsername: target, payload: { type: 'conn-accept', key: myPubKey }}); 
    addLog(`✅ Connection Accepted: ${target}`); 
  };

  const startBatchTransfer = async (files: File[], algos: Map<string, string>) => {
    if (!encryptionReady || !sharedKeyRef.current) return alert("Please connect to a peer first!");
    
    setIsTransferring(true); // 🔒 Lock Page

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const algo = algos.get(file.name) || 'None';
        
        setQueueStatus(`Transferring ${i + 1}/${files.length}: ${file.name}`);
        addLog(`🚀 [${i+1}/${files.length}] Uploading "${file.name}"...`);
        setProgress(0);
        setTransferStats(null);

        socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-start', name: file.name, algo: algo } });
        await new Promise(r => setTimeout(r, 50));

        // STOP-AND-WAIT PIPELINE
        const stats = await sendFilePipeline(file, sharedKeyRef.current, algo, async (chunk) => {
          await new Promise<void>((resolve) => {
            socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-chunk', chunk } }, () => resolve());
          });
          setProgress(p => (p >= 95 ? 95 : p + 0.5));
        });

        setTransferStats(stats);
        socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-end' }});
        addLog(`✅ Sent: "${file.name}"`);
        setProgress(100);
        await new Promise(r => setTimeout(r, 500));
      }
      setQueueStatus('');
      addLog("🏁 Batch Transfer Complete!");
    } catch (e) {
      addLog("❌ Transfer Interrupted");
    } finally {
      setIsTransferring(false); // 🔓 Unlock Page
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="text-blue-500" /> SmartStream <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Prototype</span>
          </h1>
          
          <div className="flex items-center gap-6">
            <div className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1 ${status.includes('Online') ? 'text-green-400 bg-green-900/20 border-green-900' : 'text-red-400 bg-red-900/20 border-red-900'}`}>
              <Wifi className="w-3 h-3"/> {status}
            </div>
            
            <div className="flex items-center gap-3 pl-6 border-l border-gray-700">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-white leading-none">{username}</p>
                <p className="text-[10px] text-gray-400">Secured Node</p>
              </div>
              <div className="bg-gray-700 p-2 rounded-full">
                <UserCircle className="w-6 h-6 text-gray-300" />
              </div>
              <button onClick={handleLogout} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 p-2 rounded-lg transition" title="Logout">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* CONNECTION REQUEST MODAL */}
        {incomingRequest && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-gray-800 p-6 rounded-xl border border-blue-500 shadow-2xl max-w-sm w-full text-center">
              <Bell className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-bounce"/>
              <h3 className="text-lg font-bold mb-2">Incoming Connection</h3>
              <p className="text-gray-400 mb-6"><span className="text-white font-bold">{incomingRequest.from}</span> wants to connect.</p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setIncomingRequest(null)} className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition">Decline</button>
                <button onClick={acceptConnection} className="px-4 py-2 bg-blue-600 rounded-lg font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-500/30">Accept</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* LEFT COLUMN: Search & Transfer */}
          <div className="space-y-6">
            
            {/* 🔍 SEARCH BOX */}
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
              <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex gap-2"><Search className="w-4" /> Connect to Peer</h3>
              
              {encryptionReady ? (
                // CONNECTED STATE
                <div className="bg-green-900/20 border border-green-500/50 p-4 rounded-lg flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-500 p-2 rounded-full"><Lock className="w-5 h-5 text-white" /></div>
                    <div>
                      <p className="text-sm text-gray-400">Connected to</p>
                      <p className="text-lg font-bold text-white">{targetUser}</p>
                    </div>
                  </div>
                  <button onClick={() => { setEncryptionReady(false); setTargetUser(''); addLog("🔌 Disconnected manually."); }} className="bg-red-500/20 text-red-400 p-2 rounded hover:bg-red-500/30 transition" title="Disconnect">
                    <Link2Off className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                // SEARCH STATE
                <div className="space-y-4">
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="Enter Username to Connect..." 
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white outline-none focus:border-blue-500 transition"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
                    />
                    <Search className="absolute left-3 top-3.5 text-gray-500 w-5 h-5" />
                  </div>

                  {searchQuery && (
                    <div className={`p-4 rounded-lg border flex items-center justify-between transition-all duration-300 ${searchResult ? 'bg-gray-700 border-gray-600' : 'bg-red-900/10 border-red-900/30'}`}>
                      {searchResult ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="font-mono text-white">{searchResult}</span>
                          </div>
                          <button onClick={() => sendConnectionRequest(searchResult)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-md text-sm font-bold transition flex items-center gap-2">
                            Connect <UserCheck className="w-4" />
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-400 w-full justify-center py-1">
                          <UserX className="w-4 h-4 text-red-400" /> User Not Available
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* TRANSFER ZONE */}
            <div className={`bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg relative overflow-hidden transition-opacity ${!encryptionReady ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
              <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex justify-between items-center">
                <span>AI Transfer Zone</span>
                {queueStatus && <span className="text-blue-400 text-[10px] animate-pulse flex items-center gap-1 bg-blue-900/20 px-2 py-1 rounded"><Layers className="w-3" /> BATCH ACTIVE</span>}
              </h3>
              <FilePicker onFilesSelected={startBatchTransfer} disabled={!encryptionReady || !!queueStatus} />
              {!encryptionReady && <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold bg-black/20 backdrop-blur-[1px]">🔒 Connect to Peer First</div>}
            </div>

            {/* STATS */}
            {transferStats && (
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-xl border border-blue-500/30 shadow-xl">
                <h3 className="text-sm font-bold text-blue-400 uppercase mb-4 flex gap-2"><Activity className="w-4" /> Metrics</h3>
                <div className="grid grid-cols-2 gap-4 text-xs font-mono text-gray-300">
                  <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
                    <p className="text-gray-500 mb-1">Total Size</p>
                    <p className="text-lg font-bold text-white">{(transferStats.originalSize/1024/1024).toFixed(2)} MB</p>
                  </div>
                  <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
                    <p className="text-gray-500 mb-1">Data Sent</p>
                    <p className="text-lg font-bold text-blue-400">
                       {(transferStats.finalSize/1024/1024 < 1 ? (transferStats.finalSize/1024).toFixed(2) + " KB" : (transferStats.finalSize/1024/1024).toFixed(2) + " MB")}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
                    <p className="text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3"/> Time</p>
                    <p className="text-lg font-bold text-white">{transferStats.duration}s</p>
                  </div>
                  <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
                    <p className="text-gray-500 mb-1 flex items-center gap-1"><Activity className="w-3"/> Speed</p>
                    <p className="text-lg font-bold text-green-400">{transferStats.speed ? `${transferStats.speed} MB/s` : '---'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Files & Logs */}
          <div className="space-y-6">
            {receivedFiles.length > 0 && (
              <div className="bg-green-900/10 p-6 rounded-xl border border-green-500/30 shadow-lg">
                <h3 className="text-sm font-bold text-green-400 uppercase mb-4 flex gap-2"><Download className="w-4" /> Received Files</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                  {receivedFiles.map((f, i) => (
                    <div key={i} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700 hover:border-green-500/50 transition">
                      <span className="truncate text-sm font-mono text-gray-300">{f.name}</span>
                      <a href={f.url} download={f.name} className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-lg shadow-green-900/20">Save</a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-black p-4 rounded-xl border border-gray-800 h-96 overflow-hidden flex flex-col font-mono text-xs shadow-inner">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
                <span className="text-gray-500 flex items-center gap-2"><Cpu className="w-3 h-3"/> System Logs</span>
                <span className="text-gray-600">Live</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                {logs.map((log, i) => (
                  <div key={i} className="text-green-400 border-l-2 border-green-900 pl-2 py-0.5 hover:bg-gray-900/50 transition">
                    <span className="text-gray-600 mr-2">[{new Date().toLocaleTimeString()}]</span>{log}
                  </div>
                ))}
              </div>
            </div>
            
            {/* ALERT BANNER & PROGRESS */}
            {queueStatus && (
              <div className={`text-center text-xs font-bold py-2 rounded border animate-pulse ${queueStatus.includes('LOST') ? 'text-red-400 bg-red-900/20 border-red-900' : 'text-blue-400 bg-blue-900/10 border-blue-900/30'}`}>
                {queueStatus}
              </div>
            )}
            
            {progress > 0 && (
              <div className="relative w-full bg-gray-700 rounded-full h-3 overflow-hidden shadow-inner">
                <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};







// //v1.4
// import { useEffect, useState, useRef } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { io, Socket } from 'socket.io-client';
// import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
// import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
// import { FilePicker } from './FilePicker';
// import { Cpu, Wifi, Download, Bell, Lock, Activity, Clock, Layers, UserCircle, LogOut, Search, UserX, UserCheck, Link2Off } from 'lucide-react';

// const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
// const socket: Socket = io(SERVER_URL, { transports: ['websocket'], reconnectionAttempts: 5 });

// export const TransferRoom = () => {
//   const navigate = useNavigate();
  
//   // --- STATE ---
//   const [username, setUsername] = useState(localStorage.getItem('username') || '');
//   const [status, setStatus] = useState('Connecting...');
  
//   // Search & Peers
//   const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
//   const [searchQuery, setSearchQuery] = useState('');
//   const [searchResult, setSearchResult] = useState<string | null>(null);

//   // Connection
//   const [targetUser, setTargetUser] = useState('');
//   const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);
//   const [encryptionReady, setEncryptionReady] = useState(false);
  
//   // Transfer
//   const [progress, setProgress] = useState(0);
//   const [logs, setLogs] = useState<string[]>([]);
//   const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
//   const [transferStats, setTransferStats] = useState<any>(null);
//   const [queueStatus, setQueueStatus] = useState(''); 

//   const keyPairRef = useRef<CryptoKeyPair | null>(null);
//   const sharedKeyRef = useRef<CryptoKey | null>(null);
//   const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

//   const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), msg]);

//   // --- INIT & AUTH ---
//   useEffect(() => {
//     if (!username) { navigate('/auth'); return; }

//     const cleanName = username.trim(); // <--- Ensure clean name on register

//     generateKeyPair().then(keys => { keyPairRef.current = keys; addLog("🔐 ID Keys Generated"); });

//     socket.emit('register-user', cleanName);
//     setStatus('🟢 Online');
//     addLog(`✅ Logged in as ${username}`);

//     socket.on('connect', () => { setStatus('🟢 Online'); socket.emit('register-user', username); });
//     socket.on('disconnect', () => { setStatus('🔴 Offline'); });

//     // --- RECEIVER LOGIC ---
//     socket.on('file-relay', async (data: any, ackCallback: Function) => {
//       const { from, payload } = data;
//       if (!from) return;

//       if (payload.type === 'conn-request') {
//         setIncomingRequest({ from, key: payload.key });
//       }
//       else if (payload.type === 'conn-accept') {
//         const foreignKey = await importPublicKey(payload.key);
//         if (keyPairRef.current) {
//           sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
//           setEncryptionReady(true);
//           setTargetUser(from);
//           setSearchResult(null); // Clear search UI on connect
//           setSearchQuery('');
//           addLog(`✅ Secure Link Established with ${from}`);
//         }
//       }
//       else if (payload.type === 'file-start') {
//         const algo = payload.algo || 'None';
//         addLog(`📥 Receiving: ${payload.name}`);
//         setProgress(0);
//         setTransferStats(null);

//         if (sharedKeyRef.current) {
//           receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, algo, (blob, stats) => {
//             const url = URL.createObjectURL(blob);
//             setReceivedFiles(prev => [...prev, { name: payload.name, url }]);
//             setTransferStats(stats);
//             addLog("✅ File Downloaded Successfully!");
//             setProgress(100);
//           });
//         }
//       }
//       else if (payload.type === 'file-chunk') {
//         if (receiverPipelineRef.current) {
//           receiverPipelineRef.current.processChunk(new Uint8Array(payload.chunk));
//           setProgress(p => (p >= 95 ? 95 : p + 1));
//           if (ackCallback) ackCallback("ACK"); 
//         }
//       }
//       else if (payload.type === 'file-end') {
//         addLog("⚙️ Finalizing...");
//         if (receiverPipelineRef.current) await receiverPipelineRef.current.finish();
//       }
//     });

//     return () => { socket.off('connect'); socket.off('file-relay'); socket.off('disconnect'); };
//   }, [username, navigate]);

//   // --- WATCHDOG: CONNECTION MONITOR (Every 5s) ---
//   useEffect(() => { 
//     const i = setInterval(async () => { 
//       try { 
//         // 1. Fetch latest user list
//         const res = await fetch(`${SERVER_URL}/api/users`); 
//         const d = await res.json(); 
//         const latestUsers = d.users.map((u:any) => u.username);
//         setOnlineUsers(latestUsers);

//         // 2. SEARCH UPDATE
//         if (searchQuery) {
//           if (latestUsers.includes(searchQuery) && searchQuery !== username) {
//             setSearchResult(searchQuery);
//           } else {
//             setSearchResult(null);
//           }
//         }

//         // 3. 🚨 DISCONNECTION ALERT SYSTEM
//         if (encryptionReady && targetUser) {
//           if (!latestUsers.includes(targetUser)) {
//             // A. Log it
//             addLog(`❌ CRITICAL: ${targetUser} Disconnected!`);
            
//             // B. Visual Error State (Red Background Alert)
//             setQueueStatus(`⚠️ CONNECTION LOST: ${targetUser} went offline.`);
            
//             // C. Browser Notification (If they are in another tab)
//             if (Notification.permission === "granted") {
//               new Notification("SmartStream Connection Lost", { body: `${targetUser} has disconnected.` });
//             } else if (Notification.permission !== "denied") {
//               Notification.requestPermission();
//             }

//             // D. Reset State
//             setEncryptionReady(false);
//             setTargetUser('');
//             setTransferStats(null); // Clear stats
//           }
//         }

//       } catch(e){} 
//     }, 2000); // Increased check frequency to 2s for faster feedback
//     return () => clearInterval(i); 
//   }, [searchQuery, username, encryptionReady, targetUser]);

//   // --- ACTIONS ---
//   const handleLogout = () => {
//     localStorage.removeItem('token');
//     localStorage.removeItem('username');
//     socket.disconnect();
//     navigate('/auth');
//   };

//   const sendConnectionRequest = async (target: string) => { 
//     if (!keyPairRef.current) return; 
    
//     const pubKey = await exportPublicKey(keyPairRef.current.publicKey); 
//     addLog(`📡 Requesting Connection to ${target}...`); 

//     // ✅ NEW: Wait for Server Acknowledgement/Error
//     socket.emit('file-relay', { 
//       targetUsername: target, 
//       payload: { type: 'conn-request', key: pubKey } 
//     }, (response: any) => {
//       // Check if server sent back an error
//       if (response && response.error) {
//         alert(`❌ Connection Failed: ${response.error}`);
//         addLog(`❌ Failed: ${response.error}`);
//         setSearchResult(null); // Reset search to let user try again
//       } else {
//         // Success (Receiver got the message)
//         addLog(`⏳ Waiting for ${target} to accept...`);
//       }
//     });
//   };
  
//   const acceptConnection = async () => { 
//     if(!incomingRequest || !keyPairRef.current) return; 
//     const target = incomingRequest.from; 
//     const foreignKey = await importPublicKey(incomingRequest.key); 
//     sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey); 
//     setEncryptionReady(true); 
//     setTargetUser(target); 
//     setIncomingRequest(null); 
//     const myPubKey = await exportPublicKey(keyPairRef.current.publicKey); 
//     socket.emit('file-relay', { targetUsername: target, payload: { type: 'conn-accept', key: myPubKey }}); 
//     addLog(`✅ Connection Accepted: ${target}`); 
//   };

//   const startBatchTransfer = async (files: File[], algos: Map<string, string>) => {
//     if (!encryptionReady || !sharedKeyRef.current) return alert("Please connect to a peer first!");
    
//     for (let i = 0; i < files.length; i++) {
//       const file = files[i];
//       const algo = algos.get(file.name) || 'None';
      
//       setQueueStatus(`Transferring ${i + 1}/${files.length}: ${file.name}`);
//       addLog(`🚀 [${i+1}/${files.length}] Uploading "${file.name}"...`);
//       setProgress(0);
//       setTransferStats(null);

//       socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-start', name: file.name, algo: algo } });
//       await new Promise(r => setTimeout(r, 50));

//       const stats = await sendFilePipeline(file, sharedKeyRef.current, algo, async (chunk) => {
//         await new Promise<void>((resolve) => {
//           socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-chunk', chunk } }, () => resolve());
//         });
//         setProgress(p => (p >= 95 ? 95 : p + 0.5));
//       });

//       setTransferStats(stats);
//       socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-end' }});
//       addLog(`✅ Sent: "${file.name}"`);
//       setProgress(100);
//       await new Promise(r => setTimeout(r, 500));
//     }
//     setQueueStatus('');
//     addLog("🏁 Batch Transfer Complete!");
//   };

//   return (
//     <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
//       <div className="max-w-6xl mx-auto">
        
//         {/* HEADER */}
//         <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
//           <h1 className="text-2xl font-bold flex items-center gap-2">
//             <Cpu className="text-blue-500" /> SmartStream <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">V8.2</span>
//           </h1>
          
//           <div className="flex items-center gap-6">
//             <div className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1 ${status.includes('Online') ? 'text-green-400 bg-green-900/20 border-green-900' : 'text-red-400 bg-red-900/20 border-red-900'}`}>
//               <Wifi className="w-3 h-3"/> {status}
//             </div>
            
//             <div className="flex items-center gap-3 pl-6 border-l border-gray-700">
//               <div className="text-right hidden sm:block">
//                 <p className="text-sm font-bold text-white leading-none">{username}</p>
//                 <p className="text-[10px] text-gray-400">Secured Node</p>
//               </div>
//               <div className="bg-gray-700 p-2 rounded-full">
//                 <UserCircle className="w-6 h-6 text-gray-300" />
//               </div>
//               <button onClick={handleLogout} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 p-2 rounded-lg transition" title="Logout">
//                 <LogOut className="w-5 h-5" />
//               </button>
//             </div>
//           </div>
//         </div>

//         {/* CONNECTION REQUEST MODAL */}
//         {incomingRequest && (
//           <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
//             <div className="bg-gray-800 p-6 rounded-xl border border-blue-500 shadow-2xl max-w-sm w-full text-center">
//               <Bell className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-bounce"/>
//               <h3 className="text-lg font-bold mb-2">Incoming Connection</h3>
//               <p className="text-gray-400 mb-6"><span className="text-white font-bold">{incomingRequest.from}</span> wants to connect.</p>
//               <div className="flex gap-4 justify-center">
//                 <button onClick={() => setIncomingRequest(null)} className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition">Decline</button>
//                 <button onClick={acceptConnection} className="px-4 py-2 bg-blue-600 rounded-lg font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-500/30">Accept</button>
//               </div>
//             </div>
//           </div>
//         )}

//         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
//           {/* LEFT COLUMN: Search & Transfer */}
//           <div className="space-y-6">
            
//             {/* 🔍 SEARCH BOX (Replaces List) */}
//             <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
//               <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex gap-2"><Search className="w-4" /> Connect to Peer</h3>
              
//               {encryptionReady ? (
//                 // CONNECTED STATE
//                 <div className="bg-green-900/20 border border-green-500/50 p-4 rounded-lg flex justify-between items-center">
//                   <div className="flex items-center gap-3">
//                     <div className="bg-green-500 p-2 rounded-full"><Lock className="w-5 h-5 text-white" /></div>
//                     <div>
//                       <p className="text-sm text-gray-400">Connected to</p>
//                       <p className="text-lg font-bold text-white">{targetUser}</p>
//                     </div>
//                   </div>
//                   <button onClick={() => { setEncryptionReady(false); setTargetUser(''); addLog("🔌 Disconnected manually."); }} className="bg-red-500/20 text-red-400 p-2 rounded hover:bg-red-500/30 transition" title="Disconnect">
//                     <Link2Off className="w-5 h-5" />
//                   </button>
//                 </div>
//               ) : (
//                 // SEARCH STATE
//                 <div className="space-y-4">
//                   <div className="relative">
//                     <input 
//                       type="text" 
//                       placeholder="Enter Username to Connect..." 
//                       className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 pl-10 text-white outline-none focus:border-blue-500 transition"
//                       value={searchQuery}
//                       onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
//                     />
//                     <Search className="absolute left-3 top-3.5 text-gray-500 w-5 h-5" />
//                   </div>

//                   {/* Search Result Display */}
//                   {searchQuery && (
//                     <div className={`p-4 rounded-lg border flex items-center justify-between transition-all duration-300 ${searchResult ? 'bg-gray-700 border-gray-600' : 'bg-red-900/10 border-red-900/30'}`}>
//                       {searchResult ? (
//                         <>
//                           <div className="flex items-center gap-3">
//                             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
//                             <span className="font-mono text-white">{searchResult}</span>
//                           </div>
//                           <button onClick={() => sendConnectionRequest(searchResult)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-md text-sm font-bold transition flex items-center gap-2">
//                             Connect <UserCheck className="w-4" />
//                           </button>
//                         </>
//                       ) : (
//                         <div className="flex items-center gap-2 text-gray-400 w-full justify-center py-1">
//                           <UserX className="w-4 h-4 text-red-400" /> User Not Available
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               )}
//             </div>

//             {/* TRANSFER ZONE */}
//             <div className={`bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg relative overflow-hidden transition-opacity ${!encryptionReady ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
//               <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex justify-between items-center">
//                 <span>AI Transfer Zone</span>
//                 {queueStatus && <span className="text-blue-400 text-[10px] animate-pulse flex items-center gap-1 bg-blue-900/20 px-2 py-1 rounded"><Layers className="w-3" /> BATCH ACTIVE</span>}
//               </h3>
//               <FilePicker onFilesSelected={startBatchTransfer} disabled={!encryptionReady || !!queueStatus} />
//               {!encryptionReady && <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold bg-black/20 backdrop-blur-[1px]">🔒 Connect to Peer First</div>}
//             </div>

//             {/* STATS */}
//             {transferStats && (
//               <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-xl border border-blue-500/30 shadow-xl">
//                 <h3 className="text-sm font-bold text-blue-400 uppercase mb-4 flex gap-2"><Activity className="w-4" /> Metrics</h3>
//                 <div className="grid grid-cols-2 gap-4 text-xs font-mono text-gray-300">
//                   <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
//                     <p className="text-gray-500 mb-1">Total Size</p>
//                     <p className="text-lg font-bold text-white">{(transferStats.originalSize/1024/1024).toFixed(2)} MB</p>
//                   </div>
//                   <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
//                     <p className="text-gray-500 mb-1">Data Sent</p>
//                     <p className="text-lg font-bold text-blue-400">
//                        {(transferStats.finalSize/1024/1024 < 1 ? (transferStats.finalSize/1024).toFixed(2) + " KB" : (transferStats.finalSize/1024/1024).toFixed(2) + " MB")}
//                     </p>
//                   </div>
//                   <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
//                     <p className="text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3"/> Time</p>
//                     <p className="text-lg font-bold text-white">{transferStats.duration}s</p>
//                   </div>
//                   <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
//                     <p className="text-gray-500 mb-1 flex items-center gap-1"><Activity className="w-3"/> Speed</p>
//                     <p className="text-lg font-bold text-green-400">{transferStats.speed ? `${transferStats.speed} MB/s` : '---'}</p>
//                   </div>
//                 </div>
//               </div>
//             )}
//           </div>

//           {/* RIGHT COLUMN: Files & Logs */}
//           <div className="space-y-6">
//             {receivedFiles.length > 0 && (
//               <div className="bg-green-900/10 p-6 rounded-xl border border-green-500/30 shadow-lg">
//                 <h3 className="text-sm font-bold text-green-400 uppercase mb-4 flex gap-2"><Download className="w-4" /> Received Files</h3>
//                 <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
//                   {receivedFiles.map((f, i) => (
//                     <div key={i} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700 hover:border-green-500/50 transition">
//                       <span className="truncate text-sm font-mono text-gray-300">{f.name}</span>
//                       <a href={f.url} download={f.name} className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-lg shadow-green-900/20">Save</a>
//                     </div>
//                   ))}
//                 </div>
//               </div>
//             )}

//             <div className="bg-black p-4 rounded-xl border border-gray-800 h-96 overflow-hidden flex flex-col font-mono text-xs shadow-inner">
//               <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
//                 <span className="text-gray-500 flex items-center gap-2"><Cpu className="w-3 h-3"/> System Logs</span>
//                 <span className="text-gray-600">Live</span>
//               </div>
//               <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
//                 {logs.map((log, i) => (
//                   <div key={i} className="text-green-400 border-l-2 border-green-900 pl-2 py-0.5 hover:bg-gray-900/50 transition">
//                     <span className="text-gray-600 mr-2">[{new Date().toLocaleTimeString()}]</span>{log}
//                   </div>
//                 ))}
//               </div>
//             </div>
            
//             {progress > 0 && (
//               <div className="relative w-full bg-gray-700 rounded-full h-3 overflow-hidden shadow-inner">
//                 <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
//               </div>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

//v1.3
// import { useEffect, useState, useRef } from 'react';
// import { io, Socket } from 'socket.io-client';
// import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
// import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
// import { FilePicker } from './FilePicker';
// import { ShieldCheck, Cpu, Terminal, Users, Wifi, Download, Check, X, Bell, Lock, Activity, Clock, FileWarning } from 'lucide-react';

// const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
// const socket: Socket = io(SERVER_URL, { transports: ['websocket'], reconnectionAttempts: 5 });

// export const TransferRoom = () => {
//   const [username, setUsername] = useState('');
//   const [joined, setJoined] = useState(false);
//   const [status, setStatus] = useState('Disconnected');
//   const [progress, setProgress] = useState(0);
//   const [logs, setLogs] = useState<string[]>([]);
//   const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  
//   const [targetUser, setTargetUser] = useState('');
//   const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
//   const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);
//   const [encryptionReady, setEncryptionReady] = useState(false);

//   // 📊 STATS STATE
//   const [transferStats, setTransferStats] = useState<any>(null);

//   const keyPairRef = useRef<CryptoKeyPair | null>(null);
//   const sharedKeyRef = useRef<CryptoKey | null>(null);
//   const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

//   const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), msg]);

//   useEffect(() => {
//     generateKeyPair().then(keys => { keyPairRef.current = keys; addLog("🔐 ID Keys Ready"); });
//     socket.on('connect', () => { setStatus('🟡 Connected'); });

//     socket.on('file-relay', async (data: any) => {
//       const { from, payload } = data;
//       if (!from) return;

//       if (payload.type === 'conn-request') {
//         setIncomingRequest({ from, key: payload.key });
//       }
//       else if (payload.type === 'conn-accept') {
//         const foreignKey = await importPublicKey(payload.key);
//         if (keyPairRef.current) {
//           sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
//           setEncryptionReady(true);
//           setTargetUser(from);
//           addLog(`✅ Connected to ${from}`);
//         }
//       }
//       else if (payload.type === 'file-start') {
//         const algo = payload.algo || 'None';
//         addLog(`📥 Incoming: ${payload.name}`);
//         setProgress(0);
//         setTransferStats(null); // Reset stats

//         if (sharedKeyRef.current) {
//           receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, algo, (blob, stats) => {
//             const url = URL.createObjectURL(blob);
//             setReceivedFiles(prev => [...prev, { name: payload.name, url }]);
//             setTransferStats(stats); // <--- Save Receiver Stats
//             addLog("✅ File Ready!");
//             setProgress(100);
//           });
//         }
//       }
//       else if (payload.type === 'file-chunk') {
//         if (receiverPipelineRef.current) {
//           receiverPipelineRef.current.processChunk(new Uint8Array(payload.chunk));
//           setProgress(p => (p >= 95 ? 95 : p + 1));
//         }
//       }
//       else if (payload.type === 'file-end') {
//         addLog("⚙️ Processing...");
//         if (receiverPipelineRef.current) await receiverPipelineRef.current.finish();
//       }
//     });

//     return () => { socket.off('connect'); socket.off('file-relay'); };
//   }, []);

//   useEffect(() => {
//     if (joined) {
//       const i = setInterval(async () => {
//         try {
//           const res = await fetch(`${SERVER_URL}/api/users`);
//           const d = await res.json();
//           setOnlineUsers(d.users.map((u:any) => u.username));
//         } catch(e){}
//       }, 2000);
//       return () => clearInterval(i);
//     }
//   }, [joined]);

//   const handleJoin = () => { if(username) { socket.emit('register-user', username); setJoined(true); setStatus('🟢 Online'); } };
  
//   const sendConnectionRequest = async (target: string) => {
//     if(!keyPairRef.current) return;
//     const pubKey = await exportPublicKey(keyPairRef.current.publicKey);
//     socket.emit('file-relay', { targetUsername: target, payload: { type: 'conn-request', key: pubKey }});
//     addLog(`📡 Requesting ${target}...`);
//   };

//   const acceptConnection = async () => {
//     if(!incomingRequest || !keyPairRef.current) return;
//     const target = incomingRequest.from;
//     const foreignKey = await importPublicKey(incomingRequest.key);
//     sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
//     setEncryptionReady(true);
//     setTargetUser(target);
//     setIncomingRequest(null);
//     const myPubKey = await exportPublicKey(keyPairRef.current.publicKey);
//     socket.emit('file-relay', { targetUsername: target, payload: { type: 'conn-accept', key: myPubKey }});
//     addLog(`✅ Accepted ${target}`);
//   };

//   const startTransfer = async (file: File, algo: string) => {
//     if (!encryptionReady || !sharedKeyRef.current) return alert("Connect first!");
//     addLog(`🚀 Sending "${file.name}"...`);
//     setProgress(0);
//     setTransferStats(null);

//     socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-start', name: file.name, algo } });
//     await new Promise(r => setTimeout(r, 50));

//     // Get stats from Sender
//     const stats = await sendFilePipeline(file, sharedKeyRef.current, algo, async (chunk) => {
//       socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-chunk', chunk }});
//       await new Promise(r => setTimeout(r, 5));
//       setProgress(p => (p >= 95 ? 95 : p + 0.5));
//     });

//     setTransferStats(stats); // <--- Save Sender Stats
//     socket.emit('file-relay', { targetUsername: targetUser, payload: { type: 'file-end' }});
//     addLog("✅ Sent.");
//     setProgress(100);
//   };

//   return (
//     <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
//       <div className="max-w-6xl mx-auto">
//         <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
//           <h1 className="text-2xl font-bold flex items-center gap-2"><Cpu className="text-blue-500" /> SmartStream V7.1</h1>
//           <div className="flex items-center gap-4">
//             {joined && <button onClick={() => window.location.reload()} className="bg-gray-700 px-3 py-1 rounded text-xs">Logout</button>}
//             <div className="text-xs font-bold text-green-400 flex items-center gap-1"><Wifi className="w-3 h-3"/> {status}</div>
//           </div>
//         </div>

//         {incomingRequest && (
//           <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
//             <div className="bg-gray-800 p-6 rounded-xl border border-blue-500 shadow-2xl max-w-sm w-full text-center">
//               <Bell className="w-12 h-12 text-blue-400 mx-auto mb-4"/>
//               <h3 className="text-lg font-bold mb-2">Connect?</h3>
//               <p className="text-gray-400 mb-6">{incomingRequest.from} wants to secure chat.</p>
//               <div className="flex gap-4 justify-center">
//                 <button onClick={() => setIncomingRequest(null)} className="px-4 py-2 bg-gray-700 rounded-lg">Decline</button>
//                 <button onClick={acceptConnection} className="px-4 py-2 bg-blue-600 rounded-lg font-bold">Accept</button>
//               </div>
//             </div>
//           </div>
//         )}

//         {!joined ? (
//           <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700">
//             <h2 className="text-xl font-bold mb-4">Join Network</h2>
//             <input className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-4 outline-none text-white" placeholder="Enter Username" value={username} onChange={e => setUsername(e.target.value)} />
//             <button onClick={handleJoin} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded font-bold">Start Node</button>
//           </div>
//         ) : (
//           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
//             <div className="space-y-6">
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
//                 <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex gap-2"><Users className="w-4" /> Peers</h3>
//                 <div className="space-y-2 max-h-40 overflow-y-auto">
//                   {onlineUsers.filter(u => u !== username).map(u => (
//                     <div key={u} className="flex justify-between items-center bg-gray-900 p-3 rounded hover:bg-gray-700 transition">
//                       <span className="text-green-400 font-mono">● {u}</span>
//                       {targetUser === u && encryptionReady ? <span className="text-xs bg-green-900 text-green-200 px-2 py-1 rounded border border-green-700 flex items-center gap-1"><Lock className="w-3" /> Linked</span> : 
//                       <button onClick={() => sendConnectionRequest(u)} className="bg-blue-600 px-3 py-1 rounded text-xs font-bold">Request</button>}
//                     </div>
//                   ))}
//                 </div>
//               </div>
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
//                 <h3 className="text-sm font-bold text-gray-400 uppercase mb-4">AI Smart Transfer</h3>
//                 <FilePicker onFileSelected={startTransfer} disabled={!encryptionReady} />
//               </div>
              
//               {/* 📊 NEW: TRANSFER DASHBOARD */}
//               {transferStats && (
//                 <div className="bg-blue-900/20 p-6 rounded-xl border border-blue-500/30">
//                   <h3 className="text-sm font-bold text-blue-400 uppercase mb-4 flex gap-2"><Activity className="w-4" /> Last Transfer Report</h3>
//                   <div className="grid grid-cols-2 gap-4 text-xs font-mono text-gray-300">
//                     <div>
//                       <p className="text-gray-500">Total Size</p>
//                       <p className="text-lg font-bold text-white">
//                         {transferStats.originalSize ? (transferStats.originalSize/1024/1024).toFixed(2) : (transferStats.finalSize/1024/1024).toFixed(2)} MB
//                       </p>
//                     </div>
//                     <div>
//                       <p className="text-gray-500">Bandwidth Used</p>
//                       <p className="text-lg font-bold text-blue-400">
//                         {(transferStats.bandwidthUsed || transferStats.received)/1024/1024 < 1 ? ((transferStats.bandwidthUsed || transferStats.received)/1024).toFixed(2) + " KB" : ((transferStats.bandwidthUsed || transferStats.received)/1024/1024).toFixed(2) + " MB"}
//                       </p>
//                     </div>
//                     <div>
//                       <p className="text-gray-500 flex items-center gap-1"><Clock className="w-3"/> Duration</p>
//                       <p>{transferStats.duration}s</p>
//                     </div>
//                     <div>
//                       <p className="text-gray-500 flex items-center gap-1"><FileWarning className="w-3"/> Bad Chunks</p>
//                       <p className={transferStats.badChunks > 0 ? "text-red-400 font-bold" : "text-green-400"}>
//                         {transferStats.badChunks}
//                       </p>
//                     </div>
//                   </div>
//                 </div>
//               )}
//             </div>

//             <div className="space-y-6">
//               {receivedFiles.length > 0 && (
//                 <div className="bg-green-900/10 p-6 rounded-xl border border-green-500/30">
//                   <h3 className="text-sm font-bold text-green-400 uppercase mb-4 flex gap-2"><Download className="w-4" /> Received Files</h3>
//                   <div className="space-y-2">
//                     {receivedFiles.map((f, i) => (
//                       <div key={i} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
//                         <span className="truncate max-w-[200px] text-sm font-mono text-gray-300">{f.name}</span>
//                         <a href={f.url} download={f.name} className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1 rounded transition">Save</a>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               )}
//               <div className="bg-black p-4 rounded-xl border border-gray-800 h-64 overflow-hidden flex flex-col font-mono text-xs">
//                 <div className="flex-1 overflow-y-auto space-y-1">
//                   {logs.map((log, i) => <div key={i} className="text-green-400 border-l-2 border-green-900 pl-2"><span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span> {log}</div>)}
//                 </div>
//               </div>
//               {progress > 0 && <div className="w-full bg-gray-700 rounded-full h-2"><div className="bg-blue-500 h-2" style={{ width: `${progress}%` }}></div></div>}
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };


//V1.2
// import { useEffect, useState, useRef } from 'react';
// import { io, Socket } from 'socket.io-client';
// import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
// import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
// import { FilePicker } from './FilePicker'; // ✅ Ensure this component handles the AI UI
// import { ShieldCheck, Cpu, Terminal, AlertCircle, Users, Wifi, Download } from 'lucide-react';

// // ⚠️ CHANGE THIS TO YOUR HOST IP (e.g., http://192.168.1.5:3001) for cross-device
// const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// const socket: Socket = io(SERVER_URL, {
//   transports: ['websocket'],
//   reconnectionAttempts: 5,
// });

// export const TransferRoom = () => {
//   const [username, setUsername] = useState('');
//   const [targetUser, setTargetUser] = useState('');
//   const [joined, setJoined] = useState(false);
//   const [status, setStatus] = useState('Disconnected');
//   const [progress, setProgress] = useState(0);
//   const [logs, setLogs] = useState<string[]>([]);
//   const [error, setError] = useState('');
//   const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  
//   // ✅ NEW: Received Files List
//   const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  
//   const keyPairRef = useRef<CryptoKeyPair | null>(null);
//   const sharedKeyRef = useRef<CryptoKey | null>(null);
//   const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

//   const addLog = (msg: string) => {
//     // Keep log clean, max 20 lines
//     setLogs(prev => [...prev.slice(-19), msg]);
//   };

//   // --- 1. SETUP & LISTENERS ---
//   useEffect(() => {
//     // Generate Keys
//     generateKeyPair().then(keys => {
//       keyPairRef.current = keys;
//       addLog("🔐 Crypto Keys Generated");
//     });

//     socket.on('connect', () => {
//       setStatus('🟡 Server Connected');
//     });

//     socket.on('disconnect', () => setStatus('🔴 Disconnected'));

//     // Handle User List
//     socket.on('user-online', (data: any) => {
//       // In a real app, you'd manage the full list array here
//     });

//     // 📨 INCOMING DATA HANDLER
//     socket.on('file-relay', async (data: any) => {
//       const { from, payload } = data;

//       // A. Handshake
//       if (payload.type === 'key-swap') {
//         addLog(`🔑 Received Key from ${from}`);
//         const foreignKey = await importPublicKey(payload.key);
//         if (keyPairRef.current) {
//           sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
//           addLog("🔒 Encryption Established");
//           setStatus('🟢 Secure Tunnel Ready');
//         }
//       } 
      
//       // B. File Start
//       else if (payload.type === 'file-start') {
//         console.log("📂 START:", payload.name);
//         addLog(`📥 Receiving: ${payload.name}`);
//         setProgress(0);
        
//         if (sharedKeyRef.current) {
//           receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, (blob) => {
//             // ✅ THIS RUNS WHEN 'finish()' IS CALLED
//             console.log("✅ CALLBACK FIRED: File Reconstructed");
//             addLog("✅ File Reconstructed!");
            
//             const url = URL.createObjectURL(blob);
//             setReceivedFiles(prev => [...prev, { name: payload.name, url }]);
//             setProgress(100);
//           });
//         }
//       } 
      
//       // C. File Chunk
//       else if (payload.type === 'file-chunk') {
//         if (receiverPipelineRef.current) {
//           try {
//             await receiverPipelineRef.current.processChunk(new Uint8Array(payload.chunk));
//             setProgress(p => (p >= 95 ? 95 : p + 1));
//           } catch (e) { console.error(e); }
//         }
//       }

//       // D. File End (The Trigger)
//       else if (payload.type === 'file-end') {
//         console.log("🏁 End Signal Received");
//         if (receiverPipelineRef.current) {
//           receiverPipelineRef.current.finish(); // Calls the callback above
//         }
//       }
//     });

//     return () => {
//       socket.off('connect');
//       socket.off('file-relay');
//     };
//   }, []);

//   // Poll for users
//   useEffect(() => {
//     if (joined) {
//       const interval = setInterval(async () => {
//         try {
//           const res = await fetch(`${SERVER_URL}/api/users`);
//           const data = await res.json();
//           setOnlineUsers(data.users.map((u: any) => u.username));
//         } catch (e) {}
//       }, 2000);
//       return () => clearInterval(interval);
//     }
//   }, [joined]);


//   // --- 2. ACTION HANDLERS ---

//   const handleJoin = () => {
//     if (!username) return;
//     socket.emit('register-user', username, socket.id);
//     setJoined(true);
//     setStatus('🟢 Online');
//   };

//   const handleConnect = async () => {
//     if (!targetUser || !keyPairRef.current) return;
//     addLog(`📞 Handshaking with ${targetUser}...`);
//     const pubKey = await exportPublicKey(keyPairRef.current.publicKey);
//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'key-swap', key: pubKey }
//     });
//   };

//   // ✅ RESTORED: AI & Compression Logic
//   // This function is passed to <FilePicker />
//   const startTransfer = async (file: File, algo: string) => {
//     if (!sharedKeyRef.current) return setError("⚠️ Connect to a user first!");
    
//     addLog(`🤖 AI Optimized: Sending "${file.name}" using ${algo}...`);
//     setProgress(0);

//     // 1. Notify Start
//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'file-start', name: file.name }
//     });

//     // 2. Send Chunks with Delay
//     await sendFilePipeline(file, sharedKeyRef.current, async (chunk) => {
//       socket.emit('file-relay', {
//         targetUsername: targetUser,
//         payload: { type: 'file-chunk', chunk }
//       });
//       // ⚠️ IMPORTANT: Small delay to prevent crashing the socket
//       await new Promise(r => setTimeout(r, 5));
//       setProgress(p => (p >= 95 ? 95 : p + 0.5));
//     });

//     // 3. Notify End
//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'file-end' }
//     });
    
//     addLog("✅ Upload Complete.");
//     setProgress(100);
//   };

//   // --- 3. RENDER ---

//   return (
//     <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
//       <div className="max-w-6xl mx-auto">
        
//         {/* Header */}
//         <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
//           <h1 className="text-2xl font-bold flex items-center gap-2">
//             <Cpu className="text-blue-500" /> SmartStream <span className="text-xs bg-blue-900 px-2 rounded">RELAY</span>
//           </h1>
//           <div className="flex items-center gap-4">
//             {joined && <button onClick={() => window.location.reload()} className="bg-gray-700 px-3 py-1 rounded text-xs">Logout</button>}
//             <div className="text-xs font-bold text-green-400 flex items-center gap-1">
//               <Wifi className="w-3 h-3" /> {status}
//             </div>
//           </div>
//         </div>

//         {/* Login */}
//         {!joined ? (
//           <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-xl shadow-lg">
//             <h2 className="text-xl font-bold mb-4">Join Network</h2>
//             <input 
//               className="w-full bg-gray-900 border border-gray-600 rounded p-3 mb-4 outline-none focus:border-blue-500"
//               placeholder="Enter Username"
//               value={username}
//               onChange={e => setUsername(e.target.value)}
//             />
//             <button onClick={handleJoin} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded font-bold">Start Node</button>
//           </div>
//         ) : (
//           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
//             {/* LEFT: Controls */}
//             <div className="space-y-6">
//               {/* Users */}
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
//                 <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 flex gap-2"><Users className="w-4" /> Online Users</h3>
//                 <div className="space-y-2 max-h-40 overflow-y-auto">
//                   {onlineUsers.filter(u => u !== username).map(u => (
//                     <div key={u} className="flex justify-between items-center bg-gray-900 p-3 rounded hover:bg-gray-700 transition">
//                       <span className="text-green-400">● {u}</span>
//                       <button onClick={() => { setTargetUser(u); handleConnect(); }} className="bg-blue-600 px-3 py-1 rounded text-xs font-bold">Connect</button>
//                     </div>
//                   ))}
//                   {onlineUsers.filter(u => u !== username).length === 0 && <p className="text-gray-500 text-xs">Scanning for peers...</p>}
//                 </div>
//               </div>

//               {/* Manual Connect */}
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
//                 <div className="flex gap-2">
//                   <input className="flex-1 bg-gray-900 border border-gray-600 rounded p-2 text-sm outline-none" placeholder="Or type username..." value={targetUser} onChange={e => setTargetUser(e.target.value)} />
//                   <button onClick={handleConnect} className="bg-gray-700 px-4 rounded text-sm font-bold">Handshake</button>
//                 </div>
//               </div>

//               {/* AI File Picker */}
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
//                 <h3 className="text-sm font-bold text-gray-400 uppercase mb-4">AI Smart Transfer</h3>
//                 {/* ✅ Connected AI Logic */}
//                 <FilePicker onFileSelected={startTransfer} disabled={!sharedKeyRef.current} />
//               </div>
//             </div>

//             {/* RIGHT: Logs & Files */}
//             <div className="space-y-6">
              
//               {/* ✅ RECEIVED FILES LIST (The missing piece) */}
//               {receivedFiles.length > 0 && (
//                 <div className="bg-green-900/20 p-6 rounded-xl border border-green-500/30">
//                   <h3 className="text-sm font-bold text-green-400 uppercase mb-4 flex gap-2"><Download className="w-4" /> Received Files</h3>
//                   <div className="space-y-2">
//                     {receivedFiles.map((f, i) => (
//                       <div key={i} className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
//                         <span className="truncate max-w-[200px] text-sm font-mono">{f.name}</span>
//                         <a href={f.url} download={f.name} className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1 rounded">Download</a>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               )}

//               {/* Encryption Status */}
//               <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex justify-between items-center">
//                 <div>
//                   <h3 className="font-bold">Encryption Layer</h3>
//                   <p className={`text-xs mt-1 ${sharedKeyRef.current ? 'text-green-400' : 'text-yellow-500'}`}>
//                     {sharedKeyRef.current ? '🔒 AES-GCM-256 (Active)' : '⏳ Waiting for Handshake...'}
//                   </p>
//                 </div>
//                 <ShieldCheck className={`w-8 h-8 ${sharedKeyRef.current ? 'text-green-500' : 'text-gray-600'}`} />
//               </div>

//               {/* Logs */}
//               <div className="bg-black p-4 rounded-xl border border-gray-800 h-80 overflow-hidden flex flex-col font-mono text-xs">
//                 <div className="flex items-center gap-2 text-gray-500 mb-2 border-b border-gray-800 pb-2"><Terminal className="w-4" /> System Log</div>
//                 <div className="flex-1 overflow-y-auto space-y-1">
//                   {logs.map((log, i) => (
//                     <div key={i} className="text-green-400 break-words border-l-2 border-green-900 pl-2">
//                       <span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span> {log}
//                     </div>
//                   ))}
//                 </div>
//               </div>

//               {/* Progress */}
//               {progress > 0 && (
//                 <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
//                   <div className="bg-blue-500 h-2 transition-all duration-300" style={{ width: `${progress}%` }}></div>
//                 </div>
//               )}
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };











// import { useEffect, useState, useRef } from 'react';
// import { io, Socket } from 'socket.io-client';
// import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
// import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
// import { FilePicker } from './FilePicker';
// import { ShieldCheck, Cpu, Terminal, AlertCircle, Users, Wifi } from 'lucide-react';

// // 🔌 Initialize Socket Connection (Singleton)
// // ⚠️ IMPORTANT: If testing on 2 devices, change 'localhost' to your LAN IP (e.g. 'http://192.168.1.5:3001')
// const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// const socket: Socket = io(SERVER_URL, {
//   transports: ['websocket', 'polling'], // Force stable transport
//   reconnectionAttempts: 5,
// });

// export const TransferRoom = () => {
//   const [username, setUsername] = useState('');
//   const [targetUser, setTargetUser] = useState('');
//   const [joined, setJoined] = useState(false);
//   const [status, setStatus] = useState('Disconnected');
//   const [progress, setProgress] = useState(0);
//   const [logs, setLogs] = useState<string[]>([]);
//   const [error, setError] = useState('');
//   const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
//   // Add this new state
//   const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  
//   // Refs for heavy objects
//   const keyPairRef = useRef<CryptoKeyPair | null>(null);
//   const sharedKeyRef = useRef<CryptoKey | null>(null);
//   const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

//   const addLog = (msg: string) => {
//     console.log(msg);
//     setLogs(prev => [...prev.slice(-9), msg]);
//   };

//   // 📨 SETUP & LISTENERS (Corrected Version)
//   useEffect(() => {
//     // 🛑 1. GENERATE KEYS IMMEDIATELY (Restored this!)
//     generateKeyPair().then(keys => {
//       keyPairRef.current = keys;
//       addLog("🔐 Crypto Keys Generated");
//     });

//     // 2. Connection Status
//     socket.on('connect', () => {
//       setStatus('🟡 Server Connected');
//       addLog("✅ Connected to Relay Server");
//     });

//     socket.on('disconnect', () => {
//       setStatus('🔴 Server Disconnected');
//       addLog("❌ Disconnected");
//     });

//     // 3. THE CORE DATA HANDLER (With Debug Logs)
//     socket.on('file-relay', async (data: any) => {
//       const { from, payload } = data;

//       // Debug: Log protocol messages (ignore chunks to keep console clean)
//       if (payload.type !== 'file-chunk') {
//         console.log(`[Protocol] Received ${payload.type} from ${from}`);
//       }

//       // A. Handshake (Key Swap)
//       if (payload.type === 'key-swap') {
//         addLog(`🔑 Received Key from ${from}`);
//         const foreignKey = await importPublicKey(payload.key);
//         if (keyPairRef.current) {
//           sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
//           addLog("🔒 Encryption Established");
//           setStatus('🟢 Ready to Receive');
//         }
//       } 
      
//       // B. File Start (Initialize Pipeline)
//       else if (payload.type === 'file-start') {
//         console.log("📂 STARTING DOWNLOAD:", payload.name);
//         addLog(`📥 Starting Download: ${payload.name}`);
//         setProgress(0);
        
//         if (sharedKeyRef.current) {
//           // Initialize the receiver engine
//           receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, (blob) => {
//             console.log("✅ FILE RECONSTRUCTED SUCCESSFULLY");
//             addLog("✅ File Reconstructed!");
            
//             const url = URL.createObjectURL(blob);
//             setReceivedFiles(prev => [...prev, { name: payload.name, url: url }]);
//             setProgress(100);
//           });
//         } else {
//           console.error("❌ Error: Received file but no Encryption Key!");
//           addLog("❌ Error: Missing Encryption Key");
//         }
//       } 
      
//       // C. File Chunk (The Data Stream)
//       else if (payload.type === 'file-chunk') {
//         if (!receiverPipelineRef.current) {
//           // Warn only once per transfer to avoid spam
//           if (progress === 0) console.warn("⚠️ Packet dropped: Pipeline not ready");
//           return;
//         }

//         try {
//           const chunkData = new Uint8Array(payload.chunk);
//           await receiverPipelineRef.current.processChunk(chunkData);
          
//           // Visual Progress
//           setProgress(p => (p >= 95 ? 95 : p + 0.5));
          
//         } catch (err) {
//           console.error("❌ Error processing chunk:", err);
//         }
//       }

//       // D. File End (Force Save)
//       else if (payload.type === 'file-end') {
//         console.log("🏁 Received End-of-File Signal");
//         addLog("🏁 Finalizing Download...");
        
//         if (receiverPipelineRef.current) {
//           // Force the pipeline to finish and save whatever it has
//           // Note: You might need to add a method to your ReceiverPipeline class 
//           // called 'finish()' if it doesn't auto-detect end.
//           receiverPipelineRef.current.finish();
//           // For now, let's manually trigger the cleanup if needed, 
//           // but usually, the pipeline callback fires automatically when stream ends.
          
//           setProgress(100);
//         }
//       }
//     });

//     return () => {
//       socket.off('connect');
//       socket.off('disconnect');
//       socket.off('file-relay');
//     };
//   }, []);

//   // Poll for users (Simple discovery)
//   useEffect(() => {
//     const fetchUsers = async () => {
//       try {
//         const response = await fetch(`${SERVER_URL}/api/users`);
//         const data = await response.json();
//         setOnlineUsers(data.users.map((u: any) => u.username));
//       } catch (err) { }
//     };
//     if (joined) {
//       const interval = setInterval(fetchUsers, 2000);
//       return () => clearInterval(interval);
//     }
//   }, [joined]);


//   // --- ACTIONS ---

//   const handleJoin = () => {
//     if (!username.trim()) return setError('Enter a username');
    
//     // Register with Server (using socket ID as "Peer ID" placeholder)
//     addLog(`📝 Registering as ${username}...`);
//     socket.emit('register-user', username, socket.id); // Reusing socket logic
//     setJoined(true);
//     setStatus('🟢 Online');
//     setError('');
//   };

//   const handleConnect = async () => {
//     if (!targetUser.trim()) return setError('Enter target username');
//     if (!keyPairRef.current) return setError('Crypto keys not ready');

//     addLog(`📞 Handshaking with ${targetUser}...`);
    
//     // Export my public key
//     const pubKey = await exportPublicKey(keyPairRef.current.publicKey);
//     // Send Key via Server Relay
//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'key-swap', key: pubKey }
//     });
    
//     addLog("🔑 Public Key Sent. Waiting for response...");
//   };

//  const startTransfer = async (file: File) => {
//     if (!sharedKeyRef.current) return setError("⚠️ Establish connection first!");
    
//     addLog(`🚀 Sending "${file.name}" via Relay...`);
//     setProgress(0);

//     // 1. Notify Start
//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'file-start', name: file.name }
//     });

//     // 2. Send Chunks via Pipeline
//     // 👇 NOTICE: we explicitly define 'chunk' inside the parentheses below
//     await sendFilePipeline(file, sharedKeyRef.current, async (chunk) => {
      
//       // Now 'chunk' exists, so we can use it here
//       socket.emit('file-relay', {
//         targetUsername: targetUser,
//         payload: { type: 'file-chunk', chunk: chunk, size: file.size}
//       });

//       // Tiny delay to prevent flooding (5ms)
//       await new Promise(resolve => setTimeout(resolve, 5));

//       setProgress(p => (p >= 99 ? 99 : p + 0.5)); 
//     });

//     socket.emit('file-relay', {
//       targetUsername: targetUser,
//       payload: { type: 'file-end' } // <--- Send this signal
//     });
    
//     setProgress(100);
//     addLog("✅ Upload Complete.");
//   };
//   // --- RENDER ---
//   return (
//     <div className="min-h-screen bg-gray-900">
//       <div className="max-w-5xl mx-auto p-4 text-white font-sans">
        
//         {/* Header */}
//         <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
//           <h1 className="text-2xl font-bold flex items-center gap-2">
//             <Cpu className="text-blue-500" /> SmartStream <span className="text-xs bg-blue-900 text-blue-200 px-2 py-1 rounded">RELAY MODE</span>
//           </h1>
//           <div className="flex items-center gap-4">
//             {joined && (
//               <button onClick={() => window.location.reload()} className="px-3 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600">
//                 Logout
//               </button>
//             )}
//             <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${status.includes('🟢') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
//               <Wifi className="w-3 h-3" /> {status}
//             </div>
//           </div>
//         </div>

//         {/* Error Banner */}
//         {error && (
//           <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3 text-red-400">
//             <AlertCircle className="w-5 h-5" />
//             {error}
//           </div>
//         )}

//         {/* Login Screen */}
//         {!joined ? (
//           <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl">
//             <h2 className="text-xl font-bold mb-4">Identity Setup</h2>
//             <input 
//               className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 mb-4 text-white focus:border-blue-500 outline-none"
//               placeholder="Username (e.g. Alice)"
//               value={username}
//               onChange={e => setUsername(e.target.value)}
//               onKeyDown={e => e.key === 'Enter' && handleJoin()}
//             />
//             <button onClick={handleJoin} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold transition-all">
//               Join Network
//             </button>
//           </div>
//         ) : (
//           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
//             {/* LEFT COLUMN: Controls */}
//             <div className="space-y-6">
              
//               {/* Online Users List */}
//               <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
//                 <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4 flex items-center gap-2">
//                   <Users className="w-4 h-4" /> Available Users
//                 </h3>
//                 <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
//                   {onlineUsers.filter(u => u !== username).map((user) => (
//                     <div key={user} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg hover:bg-gray-700/50 transition">
//                       <span className="text-sm text-green-400 font-mono">● {user}</span>
//                       <button 
//                         onClick={() => { setTargetUser(user); handleConnect(); }}
//                         className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded font-bold transition"
//                       >
//                         Connect
//                       </button>
//                     </div>
//                   ))}
//                   {onlineUsers.filter(u => u !== username).length === 0 && (
//                     <p className="text-xs text-gray-500 italic">No other users online.</p>
//                   )}
//                 </div>
//               </div>

//               {/* Manual Connect (Backup) */}
//               <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
//                  <div className="flex gap-2">
//                   <input 
//                     className="flex-1 bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-white outline-none"
//                     placeholder="Or type username..."
//                     value={targetUser}
//                     onChange={e => setTargetUser(e.target.value)}
//                   />
//                   <button onClick={handleConnect} className="bg-gray-700 hover:bg-gray-600 px-4 rounded-lg text-sm font-bold">
//                     Handshake
//                   </button>
//                 </div>
//               </div>

//               {/* File Picker */}
//               <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
//                 <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">Secure Transfer</h3>
//                 <FilePicker onFileSelected={startTransfer} disabled={!sharedKeyRef.current} />
//               </div>
//             </div>

//             {/* RIGHT COLUMN: Status & Logs */}
//             <div className="space-y-6">

//              {/* NEW: Received Files List */}
//               {receivedFiles.length > 0 && (
//                 <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 animate-pulse-once">
//                   <h3 className="text-sm font-semibold text-green-400 uppercase mb-4 flex items-center gap-2">
//                     📥 Received Files
//                   </h3>
//                   <div className="space-y-3">
//                     {receivedFiles.map((file, idx) => (
//                       <div key={idx} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-600">
//                         <span className="text-sm font-mono text-white truncate max-w-[200px]">{file.name}</span>
//                         <a 
//                           href={file.url} 
//                           download={file.name}
//                           className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-2 rounded flex items-center gap-1 transition"
//                         >
//                           Download
//                         </a>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               )}
              
//               {/* Encryption Status */}
//               <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 flex items-center justify-between">
//                 <div>
//                   <h3 className="font-bold text-gray-200">Encryption Layer</h3>
//                   <p className={`text-xs mt-1 ${sharedKeyRef.current ? 'text-green-400' : 'text-yellow-500'}`}>
//                     {sharedKeyRef.current ? '🔒 AES-GCM-256 (Active)' : '⏳ Waiting for Handshake...'}
//                   </p>
//                 </div>
//                 <ShieldCheck className={`w-10 h-10 ${sharedKeyRef.current ? 'text-green-500' : 'text-gray-600'}`} />
//               </div>

//               {/* Terminal Logs */}
//               <div className="bg-black p-4 rounded-xl border border-gray-800 h-96 overflow-hidden flex flex-col font-mono text-xs">
//                 <div className="flex items-center gap-2 text-gray-500 mb-2 border-b border-gray-800 pb-2">
//                   <Terminal className="w-4 h-4" /> System Log
//                 </div>
//                 <div className="flex-1 overflow-y-auto space-y-1 p-1">
//                   {logs.map((log, i) => (
//                     <div key={i} className="text-green-400 break-words border-l-2 border-green-900 pl-2">
//                       <span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span> {log}
//                     </div>
//                   ))}
//                 </div>
//               </div>

//               {/* Progress Bar */}
//               {progress > 0 && (
//                 <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
//                   <div 
//                     className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 transition-all duration-300 ease-out" 
//                     style={{ width: `${progress}%` }}
//                   ></div>
//                 </div>
//               )}
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };