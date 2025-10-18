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
  console.log("🔑 ZOOM_ACCOUNT_ID:", process.env.ZOOM_ACCOUNT_ID ? "✓" : "✗");
  console.log("🔑 ZOOM_CLIENT_ID:", process.env.ZOOM_CLIENT_ID ? "✓" : "✗");
  console.log("🔑 ZOOM_CLIENT_SECRET:", process.env.ZOOM_CLIENT_SECRET ? "✓" : "✗");
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
import twinRouter from "./routes/twin.js";
import zoomRouter from "./routes/zoom.js";

// Import services and models
import deepgramService from "./services/deepgramService.js";
import zoomService from "./services/zoomService.js";
import aiService from "./services/aiService.js";
import elevenlabsService from "./services/elevenlabsService.js";
import Meeting from "./models/Meeting.js";
import mongoose from "mongoose";

// Validate service configurations
console.log("\n📋 Service Configuration Status:");
console.log(
  zoomService.validateConfig()
    ? "✅ Zoom API (Server-to-Server OAuth) configured"
    : "⚠️  Zoom API not configured - add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET"
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
console.log(
  deepgramService.validateConfig
    ? deepgramService.validateConfig()
      ? "✅ Deepgram STT configured"
      : "⚠️  Deepgram not configured - add DEEPGRAM_API_KEY"
    : "✅ Deepgram STT configured"
);
console.log("");

// Connect to MongoDB
connectDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server for WebSocket support
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8080",
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

// Routes
app.use("/api/health", healthRouter);
app.use("/api/transcription", transcriptionRouter);
app.use("/api/summary", summaryRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/twin", twinRouter);
app.use("/api/zoom", zoomRouter);

// Store WebSocket metadata for each connection
const wsClients = new Map();

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("New WebSocket connection established");

  // Initialize client metadata
  const clientId = Math.random().toString(36).substring(7);
  wsClients.set(ws, { clientId, meetingId: null });

  ws.on("message", async (message) => {
    try {
      // Handle binary audio data
      if (message instanceof Buffer) {
        const metadata = wsClients.get(ws);
        if (metadata?.meetingId) {
          // Send audio to Deepgram
          deepgramService.sendAudio(metadata.meetingId, message);
        }
        return;
      }

      // Handle JSON messages
      const data = JSON.parse(message);
      console.log("Received WebSocket message:", data.type);

      // Handle different message types
      switch (data.type) {
        case "start_transcription": {
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

          // Create new meeting in database (if connected)
          let meeting = null;
          let meetingId = `temp-${Date.now()}-${Math.random()
            .toString(36)
            .substring(7)}`;

          if (mongoose.connection.readyState === 1) {
            try {
              meeting = new Meeting({
                userId,
                title: data.title || "Untitled Meeting",
                status: "active",
              });
              await meeting.save();
              meetingId = meeting._id.toString();
              console.log("✅ Meeting saved to database:", meetingId);
            } catch (dbError) {
              console.warn(
                "⚠️ Failed to save meeting to DB, continuing without persistence:",
                dbError.message
              );
            }
          } else {
            console.warn(
              "⚠️ MongoDB not connected, transcription will work without persistence"
            );
          }

          // Store meeting ID for this connection
          const metadata = wsClients.get(ws);
          metadata.meetingId = meetingId;

          // Create Deepgram connection
          await deepgramService.createLiveTranscription(
            meetingId,
            // On transcript callback
            async (result) => {
              // Only save final transcripts to database
              if (result.isFinal && meeting) {
                try {
                  meeting.transcriptions.push({
                    speaker: "user", // TODO: Implement speaker detection
                    text: result.text,
                    confidence: result.confidence,
                    timestamp: result.timestamp,
                  });
                  await meeting.save();
                } catch (dbError) {
                  console.warn(
                    "⚠️ Failed to save transcription to DB:",
                    dbError.message
                  );
                }
              }

              // Send to frontend (both interim and final)
              ws.send(
                JSON.stringify({
                  type: "transcription",
                  data: {
                    text: result.text,
                    isFinal: result.isFinal,
                    confidence: result.confidence,
                    timestamp: result.timestamp,
                    speaker: "user",
                  },
                })
              );
            },
            // On error callback
            (error) => {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Transcription error: " + error.message,
                })
              );
            }
          );

          ws.send(
            JSON.stringify({
              type: "transcription_started",
              meetingId: meetingId,
            })
          );

          console.log(`Started transcription for meeting ${meetingId}`);
          break;
        }

        case "stop_transcription": {
          const metadata = wsClients.get(ws);

          if (metadata?.meetingId) {
            // Close Deepgram connection
            deepgramService.closeTranscription(metadata.meetingId);

            // Update meeting status in DB if connected and not a temp ID
            if (
              mongoose.connection.readyState === 1 &&
              !metadata.meetingId.startsWith("temp-")
            ) {
              try {
                const meeting = await Meeting.findById(metadata.meetingId);
                if (meeting) {
                  meeting.status = "ended";
                  meeting.endTime = new Date();
                  await meeting.save();
                  console.log("✅ Meeting status updated in database");
                }
              } catch (dbError) {
                console.warn(
                  "⚠️ Failed to update meeting in DB:",
                  dbError.message
                );
              }
            }

            ws.send(
              JSON.stringify({
                type: "transcription_stopped",
                meetingId: metadata.meetingId,
              })
            );

            console.log(
              `Stopped transcription for meeting ${metadata.meetingId}`
            );
            metadata.meetingId = null;
          }
          break;
        }

        case "bot_status_request": {
          const { botId, userId } = data;

          // Get bot by botId or userId
          let bot = null;
          if (botId) {
            bot = zoomService.getBotStatus(botId);
          } else if (userId) {
            const userBot = zoomService.getBotByUserId(userId);
            if (userBot) {
              bot = zoomService.getBotStatus(userBot.botId);
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

    // Clean up Deepgram connection if exists
    if (metadata?.meetingId) {
      deepgramService.closeTranscription(metadata.meetingId);
    }

    wsClients.delete(ws);
    console.log("WebSocket connection closed");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Zoom service event handlers - broadcast bot events to all connected clients
zoomService.on("bot-joined", (bot) => {
  console.log(`📡 Broadcasting bot-joined event for bot ${bot.botId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      const metadata = wsClients.get(client);
      // Send to the user who owns this bot
      if (metadata && bot.userId) {
        client.send(
          JSON.stringify({
            type: "bot_joined",
            data: {
              botId: bot.botId,
              meetingNumber: bot.meetingNumber,
              botName: bot.botName,
              status: bot.status,
              joinedAt: bot.joinedAt,
            },
          })
        );
      }
    }
  });
});

zoomService.on("bot-left", (bot) => {
  console.log(`📡 Broadcasting bot-left event for bot ${bot.botId}`);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      const metadata = wsClients.get(client);
      if (metadata && bot.userId) {
        client.send(
          JSON.stringify({
            type: "bot_left",
            data: {
              botId: bot.botId,
              meetingNumber: bot.meetingNumber,
            },
          })
        );
      }
    }
  });
});

zoomService.on("bot-muted", ({ botId }) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify({
          type: "bot_muted",
          data: { botId },
        })
      );
    }
  });
});

zoomService.on("bot-unmuted", ({ botId }) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify({
          type: "bot_unmuted",
          data: { botId },
        })
      );
    }
  });
});

zoomService.on("audio-injected", ({ botId, size }) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify({
          type: "bot_spoke",
          data: { botId, audioSize: size },
        })
      );
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

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server");

  // Clean up zoom bots
  await zoomService.cleanup();

  server.close(() => {
    console.log("HTTP server closed");
  });
});
