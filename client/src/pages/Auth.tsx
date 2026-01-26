import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginUser, registerUser } from '../lib/auth';
import { Lock, User, Mail, ShieldQuestion, Key } from 'lucide-react';

export const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '', email: '', password: '', fullName: '',
    securityQuestion: 'What was the name of your first pet?', securityAnswer: ''
  });
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        const { data } = await loginUser({ username: formData.username, password: formData.password });
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        window.location.href = '/dashboard'; // Force reload to clear state
      } else {
        await registerUser(formData);
        alert("Registration Successful! Please Login.");
        setIsLogin(true);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "An error occurred");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700">
        <h2 className="text-3xl font-bold text-white mb-6 text-center text-blue-500">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
                <User className="text-gray-500 w-5 h-5 mr-3" />
                <input className="bg-transparent outline-none text-white w-full" placeholder="Full Name" 
                  onChange={e => setFormData({...formData, fullName: e.target.value})} required />
              </div>
              <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
                <Mail className="text-gray-500 w-5 h-5 mr-3" />
                <input className="bg-transparent outline-none text-white w-full" type="email" placeholder="Email" 
                  onChange={e => setFormData({...formData, email: e.target.value})} required />
              </div>
            </>
          )}

          <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
            <User className="text-gray-500 w-5 h-5 mr-3" />
            <input className="bg-transparent outline-none text-white w-full" placeholder="Username" 
              onChange={e => setFormData({...formData, username: e.target.value})} required />
          </div>

          <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
            <Lock className="text-gray-500 w-5 h-5 mr-3" />
            <input className="bg-transparent outline-none text-white w-full" type="password" placeholder="Password" 
              onChange={e => setFormData({...formData, password: e.target.value})} required />
          </div>

          {!isLogin && (
            <>
              <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
                <ShieldQuestion className="text-gray-500 w-5 h-5 mr-3" />
                <select className="bg-transparent outline-none text-white w-full bg-gray-900" 
                  onChange={e => setFormData({...formData, securityQuestion: e.target.value})}>
                  <option>What was the name of your first pet?</option>
                  <option>What is your mother's maiden name?</option>
                  <option>What city were you born in?</option>
                </select>
              </div>
              <div className="input-group flex items-center bg-gray-900 p-3 rounded border border-gray-700">
                <Key className="text-gray-500 w-5 h-5 mr-3" />
                <input className="bg-transparent outline-none text-white w-full" placeholder="Security Answer" 
                  onChange={e => setFormData({...formData, securityAnswer: e.target.value})} required />
              </div>
            </>
          )}

          <button className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded font-bold text-white transition">
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <p className="text-gray-400 text-center mt-4 text-sm cursor-pointer hover:text-white" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "New here? Create Account" : "Already have an account? Login"}
        </p>
      </div>
    </div>
  );
};