# ShieldShare

ShieldShare is a Node.js and MongoDB backend for secure file sharing workflows. It includes authentication, canary file generation, risk-related data models, and Socket.IO support for real-time alerts.

## Features

- User registration, login, and authenticated profile lookup
- JWT-based API authentication
- Automatic canary files for new users
- MongoDB models for files, file versions, activity, alerts, share links, and risk snapshots
- Socket.IO rooms for user and admin notifications
- Docker Compose setup for local MongoDB

## Tech Stack

- Node.js
- Express
- MongoDB with Mongoose
- Socket.IO
- JWT authentication
- Zod validation
- Docker Compose

## Project Structure

```text
.
├── docker-compose.yml
├── package.json
├── server
│   ├── package.json
│   └── src
│       ├── app.js
│       ├── index.js
│       ├── config
│       ├── middleware
│       ├── models
│       ├── routes
│       ├── services
│       └── utils
└── .env.example
```

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- Docker, if you want to run MongoDB locally with Docker Compose

### Installation

Install root and server dependencies:

```bash
npm install
npm install --prefix server
```

Create the server environment file:

```bash
cp .env.example server/.env
```

Start MongoDB:

```bash
docker compose up -d
```

Run the API server:

```bash
npm run dev:server
```

The API will run at:

```text
http://localhost:4000
```

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/register` | Register a user |
| `POST` | `/api/auth/login` | Log in and receive a JWT |
| `GET` | `/api/auth/me` | Get the authenticated user's profile |

## Environment Variables

See `.env.example` for the local development defaults.

| Variable | Description |
| --- | --- |
| `PORT` | API server port |
| `NODE_ENV` | Runtime environment |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | JWT expiration duration |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `MAX_FILE_SIZE_MB` | Maximum file size setting |
| `ENABLE_SIMULATION` | Enables simulation features |

## Scripts

```bash
npm run dev:server
npm test
```

## License

This project is currently unlicensed.
