import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDb() {
  await mongoose.connect(env.mongoUri);
  console.log(`[db] connected: ${mongoose.connection.name}`);
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
