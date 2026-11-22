import { useMemo, useState } from "react";
import { Alert, Box, Stack, Typography } from "@mui/material";
import { Campaign, Candidate, Evaluation } from "../api";
import AgentFeedback from "../AgentFeedback";
import CandidateDrawer from "../components/CandidateDrawer";
import ScoreRing, { bandColor } from "../components/ScoreRing";
import ReportView from "../ReportView";

function CriteriaStrip({ evaluation }: { evaluation: Evaluation }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="flex-end" sx={{ height: 28 }} aria-label="Score by criterion">
      {evaluation.criterion_scores.map((c) => (
        <Box key={c.name} title={`${c.name}: ${Math.round(c.score)}`}
          sx={{ width: 8, height: `${Math.max(8, c.score)}%`, borderRadius: "2px", bgcolor: bandColor(evaluation.category), opacity: 0.85 }} />
      ))}
    </Stack>
  );
}

export default function ResultsView({ campaign, toolsUsed, finished }: {
  campaign: Campaign; toolsUsed: string[]; finished: boolean;
}) {
  const [selected, setSelected] = useState<{ candidate: Candidate; evaluation?: Evaluation }>();

  const ranked = useMemo(() => {
    const byId = new Map(campaign.evaluations.map((e) => [e.candidate_id, e]));
    return campaign.candidates
      .map((candidate) => ({ candidate, evaluation: byId.get(candidate.id) }))
      .sort((a, b) => (b.evaluation?.total_score ?? -1) - (a.evaluation?.total_score ?? -1));
  }, [campaign.candidates, campaign.evaluations]);

  const loading = finished && campaign.status !== "COMPLETED" && campaign.status !== "FAILED";

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h3" sx={{ fontSize: { xs: "1.7rem", md: "2.2rem" } }}>{campaign.job_title}</Typography>
        <Typography color="text.secondary">{campaign.location}</Typography>
      </Box>
      {loading && <Alert severity="info">Loading the final results...</Alert>}
      {campaign.limitation && <Alert severity="warning">{campaign.limitation}</Alert>}

      <Box className="results-grid">
        <Box>
          <Typography variant="h5" sx={{ mb: 1.5 }}>Ranked shortlist</Typography>
          {ranked.length === 0 ? (
            <Typography color="text.secondary" sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 2 }}>
              No candidates yet. Start the agent from the Brief to see a ranked shortlist here.
            </Typography>
          ) : (
            <Stack>
              {ranked.map(({ candidate, evaluation }, index) => (
                <Box key={candidate.id} component="button" onClick={() => setSelected({ candidate, evaluation })}
                  sx={{
                    all: "unset", cursor: "pointer", display: "grid", gridTemplateColumns: "1.5rem 52px minmax(0,1fr) auto",
                    gap: 1.5, alignItems: "center", py: 1.5, px: 1, borderBottom: "1px solid", borderColor: "divider",
                    "&:hover, &:focus-visible": { bgcolor: "action.hover" },
                  }}>
                  <Typography color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{index + 1}</Typography>
                  <ScoreRing score={evaluation?.total_score} category={evaluation?.category} size={48} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap>{candidate.name}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {[candidate.current_title, candidate.current_company].filter((x) => x && x !== "Not Found").join(", ") || "Role not found"}
                    </Typography>
                    {evaluation?.recruiter_review_required && (
                      <Typography variant="caption" color="warning.main">Needs recruiter review</Typography>
                    )}
                  </Box>
                  {evaluation && <CriteriaStrip evaluation={evaluation} />}
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Box>
          <Typography variant="h5" sx={{ mb: 1.5 }}>Recruiter briefing</Typography>
          {campaign.summary ? (
            <Box sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 1, p: { xs: 2, md: 3 } }}>
              <ReportView markdown={campaign.summary} done />
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 2 }}>
              The briefing appears here when the agent finishes writing it.
            </Typography>
          )}
        </Box>
      </Box>

      {campaign.status === "COMPLETED" && <AgentFeedback key={campaign.id} campaign={campaign} toolsUsed={toolsUsed} />}
      <CandidateDrawer candidate={selected?.candidate} evaluation={selected?.evaluation} onClose={() => setSelected(undefined)} />
    </Stack>
  );
}
