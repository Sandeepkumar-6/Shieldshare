// Socket.IO wiring: JWT-authenticated handshake, rooms, and emit helpers.
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { User } from "../models/User.js";

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await User.findById(payload.sub).lean();
      if (!user) return next(new Error("User no longer exists"));
      socket.data.user = { id: user._id.toString(), role: user.role };
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === "admin") socket.join("admins");
  });

  return io;
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToAdmins(event, payload) {
  io?.to("admins").emit(event, payload);
}

export function emitToAll(event, payload) {
  io?.emit(event, payload);
}
