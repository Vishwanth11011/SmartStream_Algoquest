import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// Ensure these functions are exported from your lib/auth file
import { loginUser, registerUser, fetchSecurityQuestion, resetPassword } from '../lib/auth';
import { Lock, User, Mail, ShieldCheck, Zap, ArrowRight, ShieldQuestion, ArrowLeft, KeyRound } from 'lucide-react';

const COLORS = {
  bg: '#0B0F14',
  surface: '#121826',
  primary: '#3B82F6',
  accent: '#22D3EE',
  success: '#22C55E',
  error: '#EF4444',
  text: '#E5E7EB',
  muted: '#9CA3AF'
};

type AuthMode = 'login' | 'register' | 'forgot';

export const AuthPage = () => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);

  // Forgot Password specific state
  const [resetStep, setResetStep] = useState(1); // 1: Username, 2: Answer
  const [fetchedQuestion, setFetchedQuestion] = useState('');

  const [formData, setFormData] = useState({
    username: '', email: '', password: '', fullName: '',
    securityQuestion: 'What was the name of your first pet?',
    securityAnswer: '',
    newPassword: '' // Used for reset
  });

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (authMode === 'login') {
        const { data } = await loginUser({ username: formData.username, password: formData.password });
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        window.location.href = '/dashboard';
      }
      else if (authMode === 'register') {
        await registerUser(formData);
        alert("Account Created! Please Login.");
        setAuthMode('login');
      }
      else if (authMode === 'forgot') {
        if (resetStep === 1) {
          // Step 1: Find User & Get Question
          const { data } = await fetchSecurityQuestion(formData.username);
          setFetchedQuestion(data.question);
          setResetStep(2);
        } else {
          // Step 2: Submit Answer & New Password
          await resetPassword({
            username: formData.username,
            securityAnswer: formData.securityAnswer,
            newPassword: formData.newPassword
          });
          alert("Password Reset Successful! Please Login.");
          setAuthMode('login');
          setResetStep(1);
          setFormData({ ...formData, securityAnswer: '', newPassword: '' });
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.message || err.response?.data?.error || "Action Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center font-sans"
      style={{ backgroundColor: COLORS.bg }}>

      {/* BACKGROUND FX */}
      <div className="absolute inset-0 w-full h-full pointer-events-none">
        <motion.div
          animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute -top-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full blur-[100px]"
          style={{ background: `radial-gradient(circle, ${COLORS.primary} 0%, transparent 70%)` }}
        />
      </div>

      <div className="absolute inset-0 pointer-events-none hidden lg:block">
        <FloatingIcon icon={ShieldCheck} color={COLORS.success} x="15%" y="20%" delay={0} label="Encryption" />
        <FloatingIcon icon={Zap} color={COLORS.primary} x="85%" y="75%" delay={2} label="Speed" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative z-10 w-full max-w-md p-1"
      >
        {/* GLOW BORDER GRADIENT */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 via-purple-500/20 to-cyan-500/30 rounded-[2rem] blur-sm" />

        <div className="relative bg-[#121826]/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] overflow-hidden min-h-[500px] flex flex-col justify-center">

          <div className="text-center mb-8">
            <motion.h1
              key={authMode}
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              className="text-5xl font-black tracking-tighter mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-cyan-400 drop-shadow-sm"
            >
              {authMode === 'login' ? 'SmartStream' : authMode === 'register' ? 'Join Network' : 'Recovery'}
            </motion.h1>
            <p className="text-sm font-medium tracking-wide" style={{ color: COLORS.muted }}>
              {authMode === 'forgot' ? 'Restore access to your secure identity' : 'Next-Gen Secure File Relay Network'}
            </p>
          </div>

          <form onSubmit={handleAuthAction} className="space-y-4">

            {/* --- RECOVERY MODE UI --- */}
            {authMode === 'forgot' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                {resetStep === 1 ? (
                  <>
                    <p className="text-sm text-center text-gray-400 mb-4">Enter your username to find your security question.</p>
                    <InputGroup icon={User} placeholder="Username" value={formData.username} onChange={(e: any) => setFormData({ ...formData, username: e.target.value })} />
                  </>
                ) : (
                  <>
                    <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl mb-4 backdrop-blur-md">
                      <p className="text-xs text-blue-400 font-bold uppercase tracking-wider mb-1">Security Question</p>
                      <p className="text-gray-200 text-sm font-medium">{fetchedQuestion}</p>
                    </div>
                    <InputGroup icon={ShieldQuestion} placeholder="Your Answer" value={formData.securityAnswer} onChange={(e: any) => setFormData({ ...formData, securityAnswer: e.target.value })} />
                    <InputGroup icon={KeyRound} placeholder="New Password" type="password" value={formData.newPassword} onChange={(e: any) => setFormData({ ...formData, newPassword: e.target.value })} />
                  </>
                )}
              </motion.div>
            )}

            {/* --- LOGIN / REGISTER UI --- */}
            {authMode !== 'forgot' && (
              <AnimatePresence mode='wait'>
                {authMode === 'register' && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    <InputGroup icon={User} placeholder="Full Name" value={formData.fullName} onChange={(e: any) => setFormData({ ...formData, fullName: e.target.value })} />
                    <InputGroup icon={Mail} placeholder="Email Address" type="email" value={formData.email} onChange={(e: any) => setFormData({ ...formData, email: e.target.value })} />
                  </motion.div>
                )}

                <motion.div className="space-y-4">
                  <InputGroup icon={User} placeholder="Username" value={formData.username} onChange={(e: any) => setFormData({ ...formData, username: e.target.value })} />
                  <InputGroup icon={Lock} placeholder="Password" type="password" value={formData.password} onChange={(e: any) => setFormData({ ...formData, password: e.target.value })} />
                </motion.div>

                {authMode === 'login' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => { setAuthMode('forgot'); setResetStep(1); }}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors tracking-wide"
                    >
                      Forgot Password?
                    </button>
                  </motion.div>
                )}

                {authMode === 'register' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 pt-2">
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-400 transition-colors z-10"><ShieldQuestion className="w-5 h-5" /></div>
                      <select
                        className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-gray-200 outline-none focus:border-blue-500/50 appearance-none cursor-pointer focus:bg-black/40 transition-all font-medium"
                        value={formData.securityQuestion}
                        onChange={e => setFormData({ ...formData, securityQuestion: e.target.value })}
                      >
                        <option>What was the name of your first pet?</option>
                        <option>What is your mother's maiden name?</option>
                        <option>What city were you born in?</option>
                        <option>What was the make of your first car?</option>
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                    </div>
                    <InputGroup icon={Lock} placeholder="Security Answer" value={formData.securityAnswer} onChange={(e: any) => setFormData({ ...formData, securityAnswer: e.target.value })} />
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* ACTION BUTTON */}
            <motion.button
              whileHover={{ scale: 1.02, boxShadow: "0 20px 30px -10px rgba(59, 130, 246, 0.4)" }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-4 mt-8 rounded-2xl font-black text-white relative overflow-hidden group shadow-lg"
              style={{ background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.accent})` }}
              disabled={loading}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-shine" />
              <span className="relative flex items-center justify-center gap-2 uppercase tracking-wider text-sm">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> :
                  (authMode === 'login' ? 'Initialize Session' : authMode === 'register' ? 'Create Identity' : resetStep === 1 ? 'Find Account' : 'Reset Password')}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </span>
            </motion.button>
          </form>

          {/* FOOTER NAV */}
          <div className="mt-8 text-center space-y-2 border-t border-white/5 pt-6">
            {authMode === 'forgot' ? (
              <p className="text-xs font-bold cursor-pointer hover:text-white transition-colors text-gray-500 flex items-center justify-center gap-2 uppercase tracking-wider"
                onClick={() => setAuthMode('login')}>
                <ArrowLeft className="w-3 h-3" /> Back to Login
              </p>
            ) : (
              <p className="text-sm cursor-pointer hover:text-white transition-colors"
                style={{ color: COLORS.muted }}
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
                {authMode === 'login' ? "Need an identity? " : "Already verified? "}
                <span className="font-bold text-blue-400 hover:text-blue-300 transition-colors">
                  {authMode === 'login' ? "Decrypt Access" : "Connect Now"}
                </span>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// IMPROVED INPUT GROUP
const InputGroup = ({ icon: Icon, type = "text", ...props }: any) => (
  <div className="relative group">
    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-300 group-focus-within:text-blue-400 text-gray-500 z-10">
      <Icon className="w-5 h-5" />
    </div>
    <input
      {...props} type={type}
      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-gray-100 outline-none transition-all duration-300
                 focus:border-blue-500/50 focus:bg-black/40 focus:shadow-[0_0_20px_rgba(59,130,246,0.1)] placeholder:text-gray-600 font-medium"
      spellCheck={false}
    />
  </div>
);

const FloatingIcon = ({ icon: Icon, color, x, y, delay, label }: any) => (
  <motion.div
    className="absolute flex flex-col items-center gap-3"
    style={{ left: x, top: y }}
    animate={{ y: [0, -20, 0] }}
    transition={{ duration: 4, repeat: Infinity, delay, ease: "easeInOut" }}
  >
    <div className="p-4 rounded-2xl bg-[#121826]/30 backdrop-blur-md border border-white/5 shadow-2xl relative group cursor-default">
      <div className="absolute inset-0 rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: color, filter: 'blur(15px)' }} />
      <Icon className="w-8 h-8 relative z-10 drop-shadow-lg" style={{ color }} />
    </div>
    <div className="px-3 py-1 rounded-full bg-black/40 backdrop-blur text-[10px] font-black tracking-widest text-gray-500 uppercase border border-white/5">
      {label}
    </div>
  </motion.div>
);

// Add missing imports if needed (Loader2, ChevronDown was used)
import { Loader2, ChevronDown } from 'lucide-react';