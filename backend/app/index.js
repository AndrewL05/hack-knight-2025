// Load environment variables FIRST (must be at the very top)
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");

console.log("🔍 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error("❌ Error loading .env:", result.error);
} else {
  console.log("✅ .env file loaded successfully");
}

// Now import everything else (after env vars are loaded)
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { connectDatabase } from "./config/database.js";

// Import routes
import healthRouter from "./routes/health.js";
import transcriptionRouter from "./routes/transcription.js";
import summaryRouter from "./routes/summary.js";
import voiceRouter from "./routes/voice.js";
import twinRouter from "./routes/assistant.js";
import recallRouter from "./routes/recall.js";
import recallDesktopRouter from "./routes/recallDesktop.js";
import webhookRouter from "./routes/webhookController.js";

// Import services and models
import recallService from "./services/recallService.js";
import recallDesktopService from "./services/recallDesktopService.js";
import aiService from "./services/aiService.js";
import elevenlabsService from "./services/elevenlabsService.js";
import Meeting from "./models/Meeting.js";
import mongoose from "mongoose";

// Validate service configurations
console.log("\n📋 Service Configuration Status:");
console.log(
  recallService.validateConfig()
    ? "✅ Recall.ai Meeting Bot configured (supports Zoom, Meet, Teams, Webex, Slack)"
    : "⚠️  Recall.ai not configured - add RECALL_API_KEY and RECALL_REGION"
);
console.log(
  recallDesktopService.validateConfig()
    ? "✅ Recall.ai Desktop SDK configured (local screen/audio recording)"
    : "⚠️  Recall.ai Desktop SDK not configured - add RECALL_API_KEY and RECALL_REGION"
);
console.log(
  "✅ Real-time transcription via Recall.ai (webhook + WebSocket)"
);
console.log(
  aiService.validateConfig()
    ? "✅ Gemini AI configured"
    : "⚠️  Gemini AI not configured - add GEMINI_API_KEY"
);
console.log(
  elevenlabsService.validateConfig()
    ? "✅ ElevenLabs TTS configured"
    : "⚠️  ElevenLabs not configured - add ELEVENLABS_API_KEY"
);
console.log("");

// Connect to MongoDB
connectDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for ngrok/reverse proxies
app.set('trust proxy', 1);

// Create HTTP server for WebSocket support
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
const allowedOrigins = [
  "http://localhost:8080",
  "https://sayless.nyc",
  "https://hack-knight-2025.vercel.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1 || process.env.FRONTEND_URL === origin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root route for testing
app.get("/", (req, res) => {
  res.json({
    message: "SayLess API is running",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      recall: "/api/recall",
      recallDesktop: "/api/recall-desktop",
      webhooks: "/api/webhooks/recall",
      webhooksDesktop: "/api/webhooks/recall-desktop",
      transcription: "/api/transcription",
      summary: "/api/summary",
      voice: "/api/voice",
      twin: "/api/twin",
    },
  });
});

// Routes
app.use("/api/health", healthRouter);
app.use("/api/transcription", transcriptionRouter);
app.use("/api/summary", summaryRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/twin", twinRouter);
app.use("/api/recall", recallRouter);
app.use("/api/recall-desktop", recallDesktopRouter);
app.use("/api/webhooks", webhookRouter);

// Store WebSocket metadata for each connection
// Maps WebSocket client -> { clientId, userId, botId }
const wsClients = new Map();

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection established");

  // Initialize client metadata
  const clientId = Math.random().toString(36).substring(7);
  wsClients.set(ws, { clientId, userId: null, botId: null });

  ws.on("message", async (message) => {
    try {
      // Parse JSON messages (no binary audio - Recall.ai handles that)
      const data = JSON.parse(message);
      console.log("📨 Received WebSocket message:", data.type);

      // Handle different message types
      switch (data.type) {
        case "register_user": {
          // Register userId with this WebSocket connection
          const { userId } = data;

          if (!userId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "userId is required",
              })
            );
            return;
          }

          const metadata = wsClients.get(ws);
          metadata.userId = userId;

          ws.send(
            JSON.stringify({
              type: "registered",
              userId: userId,
            })
          );

          console.log(`✅ User ${userId} registered on WebSocket`);
          break;
        }

        case "bot_status_request": {
          const { botId, userId } = data;

          // Get bot by botId or userId
          let bot = null;
          if (botId) {
            bot = await recallService.getBotStatus(botId);
          } else if (userId) {
            const userBot = recallService.getBotByUserId(userId);
            if (userBot) {
              bot = await recallService.getBotStatus(userBot.botId);
            }
          }

          ws.send(
            JSON.stringify({
              type: "bot_status",
              data: bot,
            })
          );
          break;
        }

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: error.message,
        })
      );
    }
  });

  ws.on("close", () => {
    const metadata = wsClients.get(ws);
    wsClients.delete(ws);
    console.log(`🔌 WebSocket connection closed for user ${metadata?.userId || 'unknown'}`);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Recall.ai service event handlers - broadcast bot events to all connected clients
recallService.on("bot-created", ({ botId, userId, status }) => {
  console.log(`📡 Broadcasting bot-created event for bot ${botId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);
      // Send to the user who owns this bot
      if (metadata) {
        client.send(
          JSON.stringify({
            type: "bot_created",
            data: {
              botId,
              userId,
              status,
            },
          })
        );
      }
    }
  });
});

recallService.on("bot-left", ({ botId, userId }) => {
  console.log(`📡 Broadcasting bot-left event for bot ${botId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);
      if (metadata) {
        client.send(
          JSON.stringify({
            type: "bot_left",
            data: {
              botId,
              userId,
            },
          })
        );
      }
    }
  });
});

// Recall.ai transcript event handler - save to DB and broadcast to frontend
recallService.on("transcript", async (transcript) => {
  const { botId, userId, speaker, text, isFinal, timestamp, confidence } = transcript;

  console.log(`📝 Transcript - Bot: ${botId}, Speaker: ${speaker}, Text: "${text}"`);

  // Save final transcripts to database
  if (isFinal && mongoose.connection.readyState === 1) {
    try {
      // Find the meeting associated with this bot
      const meeting = await Meeting.findOne({ botId, userId, status: { $ne: 'ended' } });

      if (meeting) {
        meeting.transcriptions.push({
          speaker: speaker || 'Unknown',
          text: text,
          confidence: confidence || 1.0,
          timestamp: timestamp || new Date(),
        });
        await meeting.save();
        console.log(`💾 Saved transcript to meeting ${meeting._id}`);
      }
    } catch (dbError) {
      console.warn("⚠️ Failed to save transcript to DB:", dbError.message);
    }
  }

  // Broadcast to connected WebSocket clients for this user
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);

      // Send to the user who owns this bot
      if (metadata?.userId === userId) {
        client.send(
          JSON.stringify({
            type: "transcription",
            data: {
              speaker: speaker,
              text: text,
              isFinal: isFinal,
              timestamp: timestamp,
              confidence: confidence,
              botId: botId,
            },
          })
        );
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal server error",
      status: err.status || 500,
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: "Route not found",
      status: 404,
    },
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 EchoTwin backend server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Desktop SDK service event handlers - broadcast session events to connected clients
recallDesktopService.on("session-created", ({ sessionId, userId }) => {
  console.log(`📡 Broadcasting session-created event for session ${sessionId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);
      if (metadata) {
        client.send(
          JSON.stringify({
            type: "session_created",
            data: {
              sessionId,
              userId,
            },
          })
        );
      }
    }
  });
});

recallDesktopService.on("session-stopped", ({ sessionId, userId }) => {
  console.log(`📡 Broadcasting session-stopped event for session ${sessionId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);
      if (metadata) {
        client.send(
          JSON.stringify({
            type: "session_stopped",
            data: {
              sessionId,
              userId,
            },
          })
        );
      }
    }
  });
});

// Desktop SDK transcript event handler - save to DB and broadcast to frontend
recallDesktopService.on("transcript", async (transcript) => {
  const { sessionId, userId, speaker, text, isFinal, timestamp, confidence } = transcript;

  console.log(`📝 Desktop Transcript - Session: ${sessionId}, Speaker: ${speaker}, Text: "${text}"`);

  // Save final transcripts to database
  if (isFinal && mongoose.connection.readyState === 1) {
    try {
      // Find the meeting associated with this session (sessionId stored in botId field)
      const meeting = await Meeting.findOne({ botId: sessionId, userId, status: { $ne: 'ended' } });

      if (meeting) {
        meeting.transcriptions.push({
          speaker: speaker || 'Unknown',
          text: text,
          confidence: confidence || 1.0,
          timestamp: timestamp || new Date(),
        });
        await meeting.save();
        console.log(`💾 Saved desktop transcript to meeting ${meeting._id}`);
      }
    } catch (dbError) {
      console.warn("⚠️ Failed to save desktop transcript to DB:", dbError.message);
    }
  }

  // Broadcast to connected WebSocket clients for this user
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);

      // Send to the user who owns this session
      if (metadata?.userId === userId) {
        client.send(
          JSON.stringify({
            type: "transcription",
            data: {
              speaker: speaker,
              text: text,
              isFinal: isFinal,
              timestamp: timestamp,
              confidence: confidence,
              sessionId: sessionId,
            },
          })
        );
      }
    }
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server");

  // Clean up recall bots and desktop sessions
  await recallService.cleanup();
  await recallDesktopService.cleanup();

  server.close(() => {
    console.log("HTTP server closed");
  });
});
