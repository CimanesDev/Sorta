import { AI_MODEL, aiStatus } from "@/lib/ai";

// POSTCODER_DEMO=1 marks a preview run that talks to a fake stand-in instead of real Ollama.
const DEMO = process.env.POSTCODER_DEMO === "1";

export async function AiBadge() {
  const s = await aiStatus();
  if (DEMO)
    return (
      <span className="ai-status demo" title="Preview mode: categories come from a fake stand-in, not a real AI.">
        <i />
        Fake demo AI
      </span>
    );
  const ready = s.state === "ready";
  const tip = ready
    ? `${AI_MODEL} is running on this computer. Screenshots never leave it.`
    : s.state === "offline"
      ? "Ollama isn't running. Start it from the Start menu."
      : `Ollama is running but the model isn't downloaded. Run: ollama pull ${AI_MODEL}`;
  return (
    <span className={`ai-status${ready ? " on" : ""}`} title={tip}>
      <i />
      {ready ? "AI ready" : s.state === "offline" ? "AI off" : "AI not downloaded"}
    </span>
  );
}
