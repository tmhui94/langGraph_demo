import { Box, Link, LinearProgress, Stack, Typography } from "@mui/material";
import { BoardCandidate } from "../useAgentRun";
import ScoreRing from "./ScoreRing";

/** Candidates pin onto the board as the agent saves them, and their ring fills when scored. */
export default function ShortlistBoard({ candidates, target }: { candidates: BoardCandidate[]; target: number }) {
  const scored = candidates.filter((c) => c.score !== undefined).length;
  return (
    <Box className="sticky">
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">Shortlist</Typography>
        <Typography sx={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.6rem" }}>
          {scored}<Typography component="span" color="text.secondary" sx={{ fontFamily: "inherit", fontSize: "1rem" }}> of {target} scored</Typography>
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(100, (scored / Math.max(target, 1)) * 100)}
        sx={{ height: 6, borderRadius: 3, mb: 2, bgcolor: "divider", "& .MuiLinearProgress-bar": { bgcolor: "primary.main" } }} />

      {candidates.length === 0 ? (
        <Typography color="text.secondary" sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 2 }}>
          Candidates appear here as the agent finds and scores them.
        </Typography>
      ) : (
        <Stack spacing={1.25} sx={{ maxHeight: "calc(100vh - 290px)", overflowY: "auto", pr: 0.5 }}>
          {candidates.map((c) => (
            <Box key={c.key} className="pin" sx={{
              display: "flex", gap: 1.5, alignItems: "center", p: 1.5, bgcolor: "background.paper",
              border: "1px solid", borderColor: "divider", borderRadius: 1,
            }}>
              <ScoreRing score={c.score} category={c.category} scoring={c.scoring} />
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={600} noWrap>{c.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {[c.title, c.company, c.location].filter(Boolean).join(", ") || "Details still being checked"}
                </Typography>
                {c.url && (
                  <Link href={c.url} target="_blank" rel="noreferrer" variant="caption" underline="hover">
                    View source profile
                  </Link>
                )}
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
