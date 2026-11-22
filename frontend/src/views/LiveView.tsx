import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { Campaign } from "../api";
import GraphSpine from "../components/GraphSpine";
import ShortlistBoard from "../components/ShortlistBoard";
import ThoughtStream from "../components/ThoughtStream";
import { clock } from "../labels";
import {
  RunState, countCalls, deriveCandidates, planProgress, stageStatuses, useElapsedSeconds,
} from "../useAgentRun";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.9rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  );
}

export default function LiveView({ campaign, run, onResults }: {
  campaign: Campaign; run: RunState; onResults: () => void;
}) {
  const elapsed = useElapsedSeconds(run);
  const candidates = deriveCandidates(run.sections);
  const scored = candidates.filter((c) => c.score !== undefined).length;
  const agentSteps = run.sections.filter((s) => s.node === "agent").length;

  return (
    <Stack spacing={3}>
      <Box sx={{ position: { xs: "static", md: "sticky" }, top: 61, zIndex: 5, bgcolor: "background.default", py: { md: 1.5 }, borderBottom: { md: "1px solid" }, borderColor: "divider" }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 2, md: 6 }} justifyContent="space-between" alignItems={{ md: "flex-end" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" sx={{ fontSize: { xs: "1.7rem", md: "2.2rem" } }}>{campaign.job_title}</Typography>
          <Typography color="text.secondary">{campaign.location}</Typography>
        </Box>
        <Stack direction="row" spacing={4}>
          <Stat label="Elapsed" value={clock(elapsed)} />
          <Stat label="Agent steps" value={agentSteps} />
          <Stat label="Tool calls" value={countCalls(run.sections)} />
          <Stat label="Scored" value={scored} />
        </Stack>
      </Stack>
      </Box>

      {run.error && (
        <Alert severity="error">
          {run.error}
        </Alert>
      )}
      {run.done && !run.error && (
        <Alert severity="success" action={<Button color="inherit" size="small" onClick={onResults}>See results</Button>}>
          The agent has finished and scored {scored} {scored === 1 ? "candidate" : "candidates"}.
        </Alert>
      )}

      <Box className="live-grid">
        <GraphSpine statuses={stageStatuses(run)} agentSteps={agentSteps} plan={planProgress(run.sections)} />
        <ThoughtStream sections={run.sections} lastSeq={run.lastSeq} done={run.done} />
        <ShortlistBoard candidates={candidates} target={campaign.minimum_candidates} />
      </Box>
    </Stack>
  );
}
