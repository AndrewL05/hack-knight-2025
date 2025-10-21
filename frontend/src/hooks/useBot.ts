import { useState, useCallback, useEffect, useRef } from "react";
import { useUser } from "@clerk/clerk-react";

export interface BotStatus {
  botId: string;
  meetingNumber: string;
  botName: string;
  status: string;
  isMuted: boolean;
  isAudioEnabled: boolean;
  joinedAt: Date;
  uptime: number;
}

export const useBot = () => {
  const { user } = useUser();
  const [botData, setBotData] = useState<BotStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
  const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

  /**
   * Connect to WebSocket to receive bot events
   */
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("✅ Bot WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case "bot_created":
              console.log("Bot created and joining meeting:", message.data);
              setBotData({
                botId: message.data.botId,
                meetingNumber: "", // Not used with Recall.ai
                botName: "AI Assistant",
                status: message.data.status,
                isMuted: false,
                isAudioEnabled: true,
                joinedAt: new Date(),
                uptime: 0,
              });
              break;

            case "bot_left":
              console.log("Bot left meeting:", message.data);
              setBotData(null);
              break;

            case "bot_status":
              if (message.data) {
                setBotData({
                  botId: message.data.id || message.data.botId,
                  meetingNumber: "",
                  botName: message.data.bot_name || "AI Assistant",
                  status: message.data.status?.code || message.data.status,
                  isMuted: false,
                  isAudioEnabled: true,
                  joinedAt: new Date(message.data.created_at || Date.now()),
                  uptime: 0,
                });
              }
              break;

            case "ai_response":
              console.log("AI response generated:", message.data.text);
              break;

            default:
              // Ignore other message types (transcription, etc.)
              break;
          }
        } catch (err) {
          console.error("Failed to parse bot WebSocket message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("Bot WebSocket error:", event);
      };

      ws.onclose = () => {
        console.log("Bot WebSocket disconnected");
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Failed to create bot WebSocket:", err);
    }
  }, [wsUrl]);

  /**
   * Fetch current bot status for user
   */
  const fetchBotStatus = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch(`${apiUrl}/api/recall/my-bot/${user.id}`);

      if (response.status === 404) {
        // No active bot
        setBotData(null);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch bot status");
      }

      const data = await response.json();
      if (data.success && data.bot) {
        setBotData({
          botId: data.bot.botId,
          meetingNumber: "",
          botName: data.bot.botName || "AI Assistant",
          status: data.bot.status,
          isMuted: false,
          isAudioEnabled: true,
          joinedAt: new Date(data.bot.createdAt),
          uptime: 0,
        });
      }
    } catch (err) {
      console.error("Error fetching bot status:", err);
    }
  }, [user, apiUrl]);

  /**
   * Leave meeting
   */
  const leaveMeeting = useCallback(
    async (botId?: string) => {
      if (!user && !botId) {
        setError("No bot ID or user available");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${apiUrl}/api/recall/leave`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            botId: botId || botData?.botId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to leave meeting");
        }

        setBotData(null);
        return true;
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Failed to leave meeting";
        setError(errorMsg);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [user, botData, apiUrl]
  );

  /**
   * Generate AI response
   */
  const generateResponse = useCallback(
    async (customPrompt?: string) => {
      if (!botData) {
        setError("No active bot");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${apiUrl}/api/assistant/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            botId: botData.botId,
            customPrompt,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to generate response");
        }

        console.log("✅ AI response generated:", data.response);
        return true;
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Failed to generate AI response";
        setError(errorMsg);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [botData, apiUrl]
  );

  /**
   * Make bot speak (text-to-speech)
   */
  const speak = useCallback(
    async (text: string, voiceId?: string) => {
      if (!botData) {
        setError("No active bot");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        console.log(`Bot speaking: "${text}"`);

        const response = await fetch(`${apiUrl}/api/voice/speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            botId: botData.botId,
            voiceId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to generate speech");
        }

        console.log("✅ Bot spoke successfully");
        return true;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to speak";
        setError(errorMsg);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [botData, apiUrl]
  );

  // Connect WebSocket on mount
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // Fetch bot status on mount
  useEffect(() => {
    if (user) {
      fetchBotStatus();
    }
  }, [user]); // Only run on mount when user changes

  // Poll for status updates only when bot is joining/connecting
  useEffect(() => {
    // Only poll if bot exists and is not yet in final state
    if (
      !botData ||
      botData.status === "in_call_recording" ||
      botData.status === "in_call" ||
      botData.status === "done" ||
      botData.status === "fatal"
    ) {
      return;
    }

    // Poll every 15 seconds (increased to avoid rate limiting)
    const pollInterval = setInterval(() => {
      fetchBotStatus();
    }, 15000);

    return () => clearInterval(pollInterval);
  }, [botData?.status]); // Only depend on status, not the whole fetchBotStatus function

  return {
    // State
    botData,
    isLoading,
    error,
    hasActiveBot: !!botData,

    // Actions
    fetchBotStatus,
    leaveMeeting,
    generateResponse,
    speak,
  };
};
