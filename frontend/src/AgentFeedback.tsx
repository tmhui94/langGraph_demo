import { useState } from "react";
import { Alert, Button, Card, CardContent, Rating, Stack, TextField, Typography } from "@mui/material";
import { Campaign } from "./api";
import { findByCampaign, SavedAgent, saveAgent } from "./savedAgents";

type Step = "rate" | "improve" | "thanks" | "save" | "declined" | "saved";

export default function AgentFeedback({ campaign, toolsUsed }: { campaign: Campaign; toolsUsed: string[] }) {
  const existing = findByCampaign(campaign.id);
  const [step, setStep] = useState<Step>(existing ? "saved" : "rate");
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [comment, setComment] = useState("");
  const [name, setName] = useState(`${campaign.job_title} sourcer · ${campaign.location}`);
  const [saved, setSaved] = useState<SavedAgent | undefined>(existing);

  function save() {
    const count = (category: string) => campaign.evaluations.filter((e) => e.category === category).length;
    const agent = saveAgent({
      name: name.trim() || campaign.job_title,
      rating: rating ?? 0,
      sourceCampaignId: campaign.id,
      jobTitle: campaign.job_title,
      location: campaign.location,
      jobDescription: campaign.job_description,
      minimumCandidates: campaign.minimum_candidates,
      plan: campaign.plan ?? [],
      toolsUsed,
      result: { found: campaign.candidates.length, high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW") },
    });
    setSaved(agent);
    setStep("saved");
  }

  return (
    <Card variant="outlined" sx={{ borderColor: "secondary.main" }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography fontWeight={700}>Your turn: how did the agent do?</Typography>

          {step === "rate" && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">Rate this run:</Typography>
                <Rating id="agent-rating" value={rating} onChange={(_, value) => setRating(value)} />
              </Stack>
              <Typography variant="body2">Do you love the output?</Typography>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" color="success" disabled={!rating} onClick={() => setStep("save")}>
                  Yes, I like it
                </Button>
                <Button variant="outlined" disabled={!rating} onClick={() => setStep("improve")}>
                  Not really
                </Button>
              </Stack>
            </>
          )}

          {step === "improve" && (
            <>
              <TextField
                id="agent-feedback"
                label="What should be better?"
                placeholder="e.g. search wider than Kajang, focus on Angular"
                multiline
                minRows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button variant="contained" sx={{ alignSelf: "flex-start" }} onClick={() => setStep("thanks")}>
                Send feedback
              </Button>
            </>
          )}

          {step === "thanks" && (
            <Alert severity="info">
              Thanks, noted. In a real product this feedback would shape the agent's next version:
              its instructions, its plan, or which tools it reaches for first.
            </Alert>
          )}

          {step === "save" && (
            <>
              <Typography variant="body2">
                Glad it worked. Save this as a new agent so you can run it again next time?
                It keeps the job inputs, the plan Claude made, and the tools it used
                ({toolsUsed.join(", ") || "none"}).
              </Typography>
              <TextField id="agent-name" label="Agent name" value={name} onChange={(event) => setName(event.target.value)} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={save}>Save agent</Button>
                <Button onClick={() => setStep("declined")}>No thanks</Button>
              </Stack>
            </>
          )}

          {step === "declined" && <Alert severity="info">No problem. This run is still in your campaign history.</Alert>}

          {step === "saved" && saved && (
            <Alert severity="success">
              Saved as <strong>{saved.name}</strong> (v{saved.version}). Find it under
              Create Campaign → My agents to run it again.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
