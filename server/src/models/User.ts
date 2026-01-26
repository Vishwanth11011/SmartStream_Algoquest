import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true 
  },
  password: { 
    type: String, 
    required: true 
  },
  fullName: { type: String, required: true },
  
  // Security Question for Password Recovery
  securityQuestion: { type: String, required: true },
  securityAnswer: { type: String, required: true },
  
  // Track user activity (Optional but good for stats)
  totalFilesSent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model('User', UserSchema);