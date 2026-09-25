import mongoose from 'mongoose';
import { config } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDatabase() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
