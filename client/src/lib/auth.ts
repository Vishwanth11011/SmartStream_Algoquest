import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

export const api = axios.create({ baseURL: API_URL });

// Attach token to every request if logged in
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const loginUser = async (credentials: any) => api.post('/auth/login', credentials);
export const registerUser = async (data: any) => api.post('/auth/register', data);
export const sendAIMetadata = async (data: any) => api.post('/ai/analyze', data);