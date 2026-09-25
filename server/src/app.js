import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import routes from './routes/index.js';
import publicShareRoutes from './routes/publicShare.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: config.clientOrigin, // exactly one allowed origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Share-Access'],
    exposedHeaders: ['Content-Disposition', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '100kb' }));

  // Liveness/readiness for local tooling. Reports only up/down, nothing internal.
  app.get('/api/health', (req, res) => {
    res.json({ data: { status: 'ok', database: mongoose.connection.readyState === 1 ? 'up' : 'down' } });
  });

  app.use('/api', apiLimiter, routes);
  // Public share-link access (api-contract §1 "Public /s/:token"), no authentication.
  app.use('/s', publicShareRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
