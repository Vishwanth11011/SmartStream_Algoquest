import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';
import path from 'path';

// Load env from server root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const clearData = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error("❌ MONGO_URI is missing in .env file");
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log(`✅ MongoDB Connected`);

        const result = await User.deleteMany({});
        console.log(`🗑️ Cleared ${result.deletedCount} users from the database.`);

        await mongoose.disconnect();
        console.log(`✅ Database connection closed.`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing data:', error);
        process.exit(1);
    }
};

clearData();
