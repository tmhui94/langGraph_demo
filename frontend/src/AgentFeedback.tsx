import { useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, Rating, Stack, TextField, Typography } from "@mui/material";
import { Campaign } from "./api";
import { toolLabel } from "./labels";
import { findByCampaign, SavedAgent, saveAgent, variablesFrom } from "./savedAgents";

type Step = "rate" | "improve" | "thanks" | "save" | "declined" | "saved";

export default function AgentFeedback({ campaign, toolsUsed }: { campaign: Campaign; toolsUsed: string[] }) {
  const existing = findByCampaign(campaign.id);
  const [step, setStep] = useState<Step>(existing ? "saved" : "rate");
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [comment, setComment] = useState("");
  const [name, setName] = useState(`${campaign.job_title} sourcer`);
  const [saved, setSaved] = useState<SavedAgent | undefined>(existing);

  const requirements = campaign.requirements ?? undefined;
  const variables = requirements ? variablesFrom(requirements, campaign) : [];
  const plan = campaign.plan ?? [];

  function save() {
    if (!requirements) return;
    const count = (category: string) => campaign.evaluations.filter((e) => e.category === category).length;
    const agent = saveAgent({
      name: name.trim() || campaign.job_title,
      rating: rating ?? 0,
      sourceCampaignId: campaign.id,
      prompt: campaign.job_description,
      variables,
      requirements,
      plan,
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
                Glad it worked. Save it as an agent and next time nobody has to write the prompt again,
                and the AI doesn't have to re-think the plan. It keeps the steps below and asks only for these inputs.
              </Typography>
              <Box className="brief-grid" sx={{ gap: "24px !important" }}>
                <Box>
                  <Typography fontWeight={700} sx={{ mb: 1 }}>Inputs the agent will ask for next time</Typography>
                  <Stack spacing={1}>
                    {variables.map((v) => (
                      <Box key={v.key}>
                        <Typography variant="body2" color="text.secondary">{v.label}</Typography>
                        <Typography className="hl" component="span" sx={{ px: 0.25 }}>{v.value || "(not stated)"}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
                <Box>
                  <Typography fontWeight={700} sx={{ mb: 1 }}>Saved steps</Typography>
                  <Box component="ol" sx={{ m: 0, pl: 3, display: "grid", gap: 0.75 }}>
                    {plan.map((step) => (
                      <li key={step.step}>
                        <Chip size="small" label={step.tool === "none" ? "Think" : toolLabel(step.tool)} sx={{ mr: 1 }} />
                        <Typography component="span" variant="body2" color="text.secondary">{step.purpose}</Typography>
                      </li>
                    ))}
                  </Box>
                </Box>
              </Box>
              {!requirements && <Alert severity="warning">This run has no saved requirements, so it can't be saved as an agent.</Alert>}
              <TextField id="agent-name" label="Agent name" value={name} onChange={(event) => setName(event.target.value)} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={save} disabled={!requirements}>Save agent</Button>
                <Button onClick={() => setStep("declined")}>No thanks</Button>
              </Stack>
            </>
          )}

          {step === "declined" && <Alert severity="info">No problem. This run is still in your campaign history.</Alert>}

          {step === "saved" && saved && (
            <Alert severity="success">
              Saved as <strong>{saved.name}</strong> (v{saved.version}). Find it under
              Prompt, in My agents, to run it again with new inputs.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
