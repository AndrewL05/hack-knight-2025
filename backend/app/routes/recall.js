import express from "express";
import recallService from "../services/recallService.js";
import Meeting from "../models/Meeting.js";
import mongoose from "mongoose";

const router = express.Router();

/**
 * Launch bot to join a meeting (any platform)
 * POST /api/recall/launch
 *
 * Body:
 *   - meetingUrl: Meeting URL (Zoom, Meet, Teams, etc.)
 *   - botName: Display name for the bot
 *   - userId: User ID who is launching the bot
 */
router.post("/launch", async (req, res) => {
  try {
    const { meetingUrl, botName, userId } = req.body;

    if (!meetingUrl) {
      return res.status(400).json({
        error: "Meeting URL is required",
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: "User ID is required",
      });
    }

    // Check if user already has an active bot
    const existingBot = recallService.getBotByUserId(userId);
    if (existingBot) {
      return res.status(409).json({
        error: "You already have an active bot in a meeting",
        bot: existingBot,
      });
    }

    // Create the bot
    const bot = await recallService.createBot({
      meetingUrl,
      botName: botName || "AI Assistant",
      userId,
    });

    // Create Meeting record in database
    if (mongoose.connection.readyState === 1) {
      try {
        const meeting = new Meeting({
          userId,
          botId: bot.id,
          meetingUrl:
            typeof bot.meeting_url === "string" ? bot.meeting_url : meetingUrl,
          botName: bot.bot_name || botName || "AI Assistant",
          title: `Meeting - ${new Date().toLocaleDateString()}`,
          status: "active",
        });
        await meeting.save();
        console.log(`✅ Meeting record created: ${meeting._id}`);
      } catch (dbError) {
        console.warn("⚠️ Failed to create meeting record:", dbError.message);
      }
    }

    res.json({
      success: true,
      message: "Bot is joining the meeting",
      bot: {
        botId: bot.id,
        meetingUrl: bot.meeting_url,
        botName: bot.bot_name,
        status: bot.status?.code || bot.status || "joining",
      },
    });
  } catch (error) {
    console.error("Error launching bot:", error);
    res.status(500).json({
      error: error.message || "Failed to launch bot",
    });
  }
});

/**
 * Get bot status
 * GET /api/recall/status/:botId
 */
router.get("/status/:botId", async (req, res) => {
  try {
    const { botId } = req.params;
    const status = await recallService.getBotStatus(botId);

    if (!status) {
      return res.status(404).json({
        error: "Bot not found",
      });
    }

    res.json({
      success: true,
      bot: status,
    });
  } catch (error) {
    console.error("Error getting bot status:", error);
    res.status(500).json({
      error: error.message || "Failed to get bot status",
    });
  }
});

/**
 * Leave meeting and disconnect bot
 * POST /api/recall/leave
 *
 * Body:
 *   - botId: Bot ID (optional if userId provided)
 *   - userId: User ID (optional if botId provided)
 */
router.post("/leave", async (req, res) => {
  try {
    const { botId, userId } = req.body;

    if (!botId && !userId) {
      return res.status(400).json({
        error: "Bot ID or User ID is required",
      });
    }

    // Find bot by botId or userId
    let targetBotId = botId;
    if (!targetBotId && userId) {
      const bot = recallService.getBotByUserId(userId);
      if (bot) {
        targetBotId = bot.botId;
      }
    }

    if (!targetBotId) {
      return res.status(404).json({
        error: "Bot not found",
      });
    }

    const result = await recallService.leaveBot(targetBotId);

    // Update meeting status in database
    if (mongoose.connection.readyState === 1) {
      try {
        const meeting = await Meeting.findOne({ botId: targetBotId });
        if (meeting) {
          meeting.status = "ended";
          meeting.endTime = new Date();
          await meeting.save();
          console.log(`✅ Meeting ${meeting._id} marked as ended`);
        }
      } catch (dbError) {
        console.warn("⚠️ Failed to update meeting status:", dbError.message);
      }
    }

    res.json({
      success: true,
      message: "Bot has left the meeting",
      result,
    });
  } catch (error) {
    console.error("Error leaving meeting:", error);
    res.status(500).json({
      error: error.message || "Failed to leave meeting",
    });
  }
});

/**
 * Get all active bots (admin endpoint)
 * GET /api/recall/bots
 */
router.get("/bots", (req, res) => {
  try {
    const bots = recallService.getAllBots();

    res.json({
      success: true,
      count: bots.length,
      bots,
    });
  } catch (error) {
    console.error("Error getting bots:", error);
    res.status(500).json({
      error: error.message || "Failed to get bots",
    });
  }
});

/**
 * Get user's active bot with live status
 * GET /api/recall/my-bot/:userId
 */
router.get("/my-bot/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const bot = recallService.getBotByUserId(userId);

    if (!bot) {
      return res.status(404).json({
        error: "No active bot found for this user",
      });
    }

    // Fetch live status from Recall.ai
    const liveStatus = await recallService.getBotStatus(bot.botId);

    if (liveStatus) {
      // Update cached status
      bot.status = liveStatus.status?.code || liveStatus.status;
    }

    res.json({
      success: true,
      bot,
    });
  } catch (error) {
    console.error("Error getting user bot:", error);
    res.status(500).json({
      error: error.message || "Failed to get bot",
    });
  }
});

export default router;
