import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Rocket, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useUser } from "@clerk/clerk-react";

interface LaunchBotProps {
  onBotLaunched?: (botData: any) => void;
  onError?: (error: string) => void;
}

export const LaunchBot = ({ onBotLaunched, onError }: LaunchBotProps) => {
  const { user } = useUser();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botName, setBotName] = useState("AI Assistant");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const handleLaunch = async () => {
    if (!meetingUrl.trim()) {
      setErrorMessage("Please enter a meeting URL");
      setLaunchStatus("error");
      return;
    }

    if (!user) {
      setErrorMessage("You must be signed in to launch a bot");
      setLaunchStatus("error");
      return;
    }

    setIsLaunching(true);
    setLaunchStatus("idle");
    setErrorMessage("");

    try {
      console.log("🚀 Launching Recall.ai bot...");

      const response = await fetch(`${apiUrl}/api/recall/launch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingUrl: meetingUrl.trim(),
          botName: botName.trim() || "AI Assistant",
          userId: user.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to launch bot");
      }

      console.log("✅ Bot launched successfully:", data.bot);
      setLaunchStatus("success");
      onBotLaunched?.(data.bot);

      // Clear form
      setMeetingUrl("");
    } catch (error) {
      console.error("❌ Error launching bot:", error);
      const errorMsg =
        error instanceof Error ? error.message : "Failed to launch bot";
      setErrorMessage(errorMsg);
      setLaunchStatus("error");
      onError?.(errorMsg);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <Card className="p-6 bg-card/50 backdrop-blur-glass border-primary/10">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center shadow-glow">
            <Rocket className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Launch AI Assistant</h3>
            <p className="text-sm text-muted-foreground">
              Join Zoom, Google Meet, Teams, or any meeting platform
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Meeting URL Input */}
          <div className="space-y-2">
            <Label htmlFor="meeting-url">
              Meeting URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="meeting-url"
              placeholder="https://zoom.us/j/123... or https://meet.google.com/..."
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              disabled={isLaunching}
              className="bg-background/50"
            />
            <p className="text-xs text-muted-foreground">
              Supports Zoom, Google Meet, Microsoft Teams, Webex, Slack
            </p>
          </div>

          {/* Bot Name Input */}
          <div className="space-y-2">
            <Label htmlFor="bot-name">Bot Display Name</Label>
            <Input
              id="bot-name"
              placeholder="AI Assistant"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              disabled={isLaunching}
              className="bg-background/50"
            />
          </div>

          {/* Status Messages */}
          {launchStatus === "success" && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30 text-primary">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">
                AI Assistant launched successfully!
              </span>
            </div>
          )}

          {launchStatus === "error" && errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
              <XCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Launch Button */}
          <Button
            onClick={handleLaunch}
            disabled={isLaunching || !meetingUrl.trim()}
            className="w-full bg-gradient-primary hover:shadow-glow-strong"
            size="lg"
          >
            {isLaunching ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Joining Meeting...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5 mr-2" />
                Launch AI Assistant
              </>
            )}
          </Button>
        </div>

        {/* Help Text */}
        <div className="pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            Your AI Assistant will join as a bot participant, transcribe the
            conversation, and can respond with your cloned voice.
          </p>
        </div>
      </div>
    </Card>
  );
};
