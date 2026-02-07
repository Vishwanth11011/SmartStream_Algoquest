import axios from 'axios';

// Use Vite env variable `VITE_API_BASE` if present, otherwise fall back to
// legacy `VITE_SERVER_URL` or localhost for development.
// Prefer `VITE_API_BASE`, then legacy `VITE_SERVER_URL`, then your Render URL, then localhost
const BASE = (import.meta.env.VITE_API_BASE as string) || (import.meta.env.VITE_SERVER_URL as string) || 'https://smartstream-algoquest.onrender.com' || 'http://localhost:3001';
const API_URL = `${BASE.replace(/\/$/, '')}/api`;

export const api = axios.create({ baseURL: API_URL });

// Attach token to every request if logged in
api.interceptors.request.use((config: any) => {
  const token = localStorage.getItem('token');
  if (token) config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
  return config;
}, (error: any) => Promise.reject(error));

export const loginUser = async (credentials: any) => api.post('/auth/login', credentials);
export const registerUser = async (data: any) => api.post('/auth/register', data);
export const sendAIMetadata = async (data: any) => api.post('/ai/analyze', data);