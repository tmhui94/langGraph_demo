import { Alert, Box, Drawer, IconButton, Link, Stack, Typography } from "@mui/material";
import { Candidate, Evaluation } from "../api";
import ScoreRing, { bandColor } from "./ScoreRing";

export default function CandidateDrawer({ candidate, evaluation, onClose }: {
  candidate?: Candidate; evaluation?: Evaluation; onClose: () => void;
}) {
  return (
    <Drawer anchor="right" open={Boolean(candidate)} onClose={onClose}
      PaperProps={{ sx: { width: "min(520px, 100vw)", p: 3 } }}>
      {candidate && (
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2} alignItems="center">
            <ScoreRing score={evaluation?.total_score} category={evaluation?.category} size={72} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h5">{candidate.name}</Typography>
              <Typography color="text.secondary">
                {[candidate.current_title, candidate.current_company].filter((x) => x && x !== "Not Found").join(" at ") || "Role not found in public sources"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {candidate.location !== "Not Found" ? candidate.location : "Location not found"}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="Close" sx={{ alignSelf: "flex-start" }}>✕</IconButton>
          </Stack>

          {evaluation?.recruiter_review_required && (
            <Alert severity="warning">
              Needs recruiter review: {evaluation.knockout_findings.join("; ") || "some must-haves are not evidenced."}
            </Alert>
          )}
          {candidate.summary && <Typography>{candidate.summary}</Typography>}

          {evaluation && evaluation.strengths.length > 0 && (
            <Box>
              <Typography variant="h6">Strengths</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{evaluation.strengths.map((s) => <li key={s}><Typography>{s}</Typography></li>)}</Box>
            </Box>
          )}
          {evaluation && evaluation.weaknesses.length > 0 && (
            <Box>
              <Typography variant="h6">Gaps to check</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{evaluation.weaknesses.map((s) => <li key={s}><Typography>{s}</Typography></li>)}</Box>
            </Box>
          )}

          {evaluation && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>How the score was built</Typography>
              <Stack spacing={1.5}>
                {evaluation.criterion_scores.map((c) => (
                  <Box key={c.name}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography fontWeight={600}>{c.name}</Typography>
                      <Typography>{Math.round(c.score)} / 100</Typography>
                    </Stack>
                    <Box sx={{ height: 6, borderRadius: 3, bgcolor: "divider", my: 0.5 }}>
                      <Box sx={{ height: 6, borderRadius: 3, width: `${Math.min(100, c.score)}%`, bgcolor: bandColor(evaluation.category) }} />
                    </Box>
                    {c.evidence.slice(0, 3).map((e) => (
                      <Typography key={e} variant="body2" color="text.secondary">Evidence: {e}</Typography>
                    ))}
                    {c.missing_information.slice(0, 2).map((m) => (
                      <Typography key={m} variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>Missing: {m}</Typography>
                    ))}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          <Box>
            <Typography variant="h6">Sources</Typography>
            <Stack>
              {candidate.sources.map((s) => (
                <Link key={s.url} href={s.url} target="_blank" rel="noreferrer" sx={{ wordBreak: "break-all" }}>{s.title || s.url}</Link>
              ))}
            </Stack>
          </Box>
        </Stack>
      )}
    </Drawer>
  );
}
