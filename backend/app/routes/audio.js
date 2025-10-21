import express from "express";
import audioOutputService from "../services/audioOutputService.js";

const router = express.Router();

/**
 * Output Media API endpoint - serves HTML page for Recall.ai bot
 * GET /api/audio/output-media
 *
 * This page is loaded by Recall.ai's bot and plays audio automatically
 */
router.get("/output-media", (req, res) => {
  const serverUrl = process.env.BACKEND_URL || "http://localhost:3001";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EchoTwin Audio Output</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #000;
            color: #0ff;
            font-family: 'Courier New', monospace;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .container {
            text-align: center;
        }
        .status {
            font-size: 18px;
            margin: 20px 0;
        }
        .pulse {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            background: #0ff;
            margin: 0 auto 20px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.1); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="pulse"></div>
        <div class="status" id="status">🤖 AI Assistant Ready</div>
        <audio id="audio-player" autoplay></audio>
    </div>

    <script>
        const audioPlayer = document.getElementById('audio-player');
        const statusDiv = document.getElementById('status');

        // Get botId from URL query parameters
        const urlParams = new URLSearchParams(window.location.search);
        const currentBotId = urlParams.get('botId');

        if (currentBotId) {
            console.log('Bot ID:', currentBotId);
            statusDiv.textContent = '🎧 Ready to speak...';
        }

        // Listen for messages from parent window (if needed)
        window.addEventListener('message', (event) => {
            if (event.data.type === 'PLAY_AUDIO' && event.data.botId) {
                playAudio(event.data.botId);
            }
        });

        // Play audio for a specific bot
        const playAudio = (botId) => {
            const audioUrl = '${serverUrl}/api/audio/' + botId + '?t=' + Date.now();

            statusDiv.textContent = '🔊 Speaking...';
            audioPlayer.src = audioUrl;

            audioPlayer.onended = () => {
                statusDiv.textContent = '🎧 Ready to speak...';
            };

            audioPlayer.onerror = (error) => {
                console.error('Audio playback error:', error);
                statusDiv.textContent = '⚠️ No audio available';

                // Retry after 2 seconds
                setTimeout(() => pollForAudio(botId), 2000);
            };
        };

        // Poll for audio updates
        const pollForAudio = (botId) => {
            fetch('${serverUrl}/api/audio/sessions/list')
                .then(response => response.json())
                .then(data => {
                    const session = data.sessions?.find(s => s.botId === botId);
                    if (session) {
                        playAudio(botId);
                    }
                })
                .catch(error => console.error('Poll error:', error));
        };

        // Start polling if botId is provided
        if (currentBotId) {
            setInterval(() => pollForAudio(currentBotId), 3000);
        }
    </script>
</body>
</html>
  `;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

/**
 * Serve audio file for a bot
 * GET /api/audio/:botId
 *
 * This endpoint is used by Recall.ai's Output Media API
 * to fetch the audio that the bot should speak
 */
router.get("/:botId", async (req, res) => {
  try {
    const { botId } = req.params;

    const audioBuffer = await audioOutputService.getAudioBuffer(botId);

    if (!audioBuffer) {
      return res.status(404).json({
        error: "No audio available for this bot",
      });
    }

    // Set proper headers for audio streaming
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length,
      "Cache-Control": "no-cache",
    });

    res.send(audioBuffer);
  } catch (error) {
    console.error("Error serving audio:", error);
    res.status(500).json({
      error: "Failed to serve audio",
    });
  }
});

/**
 * Get active audio sessions (for debugging)
 * GET /api/audio/sessions/list
 */
router.get("/sessions/list", (req, res) => {
  try {
    const sessions = audioOutputService.getActiveSessions();

    res.json({
      success: true,
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error("Error listing audio sessions:", error);
    res.status(500).json({
      error: "Failed to list sessions",
    });
  }
});

/**
 * Clear audio for a bot
 * DELETE /api/audio/:botId
 */
router.delete("/:botId", async (req, res) => {
  try {
    const { botId } = req.params;

    await audioOutputService.clearAudio(botId);

    res.json({
      success: true,
      message: "Audio cleared",
    });
  } catch (error) {
    console.error("Error clearing audio:", error);
    res.status(500).json({
      error: "Failed to clear audio",
    });
  }
});

export default router;
