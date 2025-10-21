# EchoTwin Backend

Express.js backend for the SayLess AI Meeting Assistant.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

3. Required API Keys:

- **Zoom API (Server-to-Server OAuth)**:
  - Go to https://marketplace.zoom.us/
  - Click "Develop" → "Build App" → "Server-to-Server OAuth"
  - Get your Account ID, Client ID, and Client Secret
  - Set: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
- **Deepgram**: Get API key from https://console.deepgram.com/
- **ElevenLabs**: Get API key from https://elevenlabs.io
- **Google Gemini**: Get API key from https://makersuite.google.com/app/apikey
- **Clerk** (Optional): Sign up at https://clerk.com for authentication

4. Start the development server:

```bash
npm run dev
```

The server will run on `http://localhost:3001`

## API Routes

### Health Check

- `GET /api/health` - Server health status

### Transcription

- `GET /api/transcription/:meetingId` - Get transcription history
- `POST /api/transcription/start` - Start real-time transcription
- `POST /api/transcription/stop` - Stop transcription

### Summary

- `GET /api/summary/:meetingId` - Get meeting summary
- `POST /api/summary/generate` - Generate summary from transcript
- `POST /api/summary/export` - Export summary

### Voice

- `POST /api/voice/clone` - Clone voice from audio samples
- `POST /api/voice/speak` - Generate speech from text
- `GET /api/voice/list/:userId` - Get user's cloned voices

### AI Twin

- `POST /api/twin/activate` - Activate AI Twin
- `POST /api/twin/deactivate` - Deactivate AI Twin
- `POST /api/twin/respond` - Send preset response
- `POST /api/twin/suggestions` - Get smart reply suggestions

## WebSocket

Connect to `ws://localhost:3001` for real-time features:

### Message Types

- `audio_stream` - Stream audio for transcription
- `ping` - Keep-alive ping

## Architecture

```
backend/
├── app/
│   ├── index.js           # Main server file
│   ├── routes/            # API route handlers
│   ├── middleware/        # Authentication & middleware
│   ├── services/          # Business logic (TBD)
│   └── controllers/       # Request handlers (TBD)
├── package.json
└── .env
```

## Development

```bash
npm run dev    # Start with nodemon (auto-restart)
npm start      # Start without auto-restart
```
