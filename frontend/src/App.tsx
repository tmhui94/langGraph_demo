import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import { api, Campaign } from "./api";
import { toolsUsed, useAgentRun } from "./useAgentRun";
import BriefView from "./views/BriefView";
import LiveView from "./views/LiveView";
import ResultsView from "./views/ResultsView";

type View = "brief" | "live" | "results";

function StepButton({ index, label, active, disabled, onClick }: {
  index: number; label: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <Button onClick={onClick} disabled={disabled} color="primary" aria-current={active ? "step" : undefined}
      sx={{ px: 1.5, fontWeight: active ? 700 : 500, opacity: disabled ? 0.45 : 1 }}>
      <Typography component="span" sx={{ fontFamily: "var(--display)", fontWeight: 700, mr: 1 }}>{index}</Typography>
      <Typography component="span" className={active ? "hl" : undefined} sx={{ fontWeight: "inherit", px: 0.25 }}>{label}</Typography>
    </Button>
  );
}

export default function App() {
  const [view, setView] = useState<View>("brief");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<Campaign[]>("/campaigns");
      setCampaigns([...response.data].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useAgentRun(activeId, load);
  const active = campaigns.find((c) => c.id === activeId);
  const canSeeResults = Boolean(active) && (run.done || active?.status === "COMPLETED");

  function started(campaign: Campaign) {
    setCampaigns((items) => [campaign, ...items.filter((c) => c.id !== campaign.id)]);
    setActiveId(campaign.id);
    setView("live");
  }

  function open(campaign: Campaign) {
    setActiveId(campaign.id);
    setView(campaign.status === "COMPLETED" ? "results" : "live");
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <Box component="header" sx={{ position: "sticky", top: 0, zIndex: 10, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider" }}>
        <Container maxWidth="xl">
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1} sx={{ minHeight: 60 }}>
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              <Typography variant="h6" sx={{ fontSize: "1.3rem" }}>Talent Scout</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
                An AI agent that sources candidates
              </Typography>
            </Stack>
            <Stack direction="row" component="nav" aria-label="Steps">
              <StepButton index={1} label="Brief" active={view === "brief"} disabled={false} onClick={() => setView("brief")} />
              <StepButton index={2} label="Live" active={view === "live"} disabled={!active} onClick={() => setView("live")} />
              <StepButton index={3} label="Results" active={view === "results"} disabled={!canSeeResults} onClick={() => setView("results")} />
            </Stack>
            <Chip size="small" variant="outlined" label="Recruiters make the final call" sx={{ display: { xs: "none", md: "inline-flex" } }} />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
        {loadError && view === "brief" && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            Cannot reach the backend. Start it, then reload this page.
          </Alert>
        )}
        {view === "brief" && <BriefView campaigns={campaigns} onStarted={started} onOpen={open} />}
        {view === "live" && active && <LiveView campaign={active} run={run} onResults={() => setView("results")} />}
        {view === "results" && active && (
          <ResultsView campaign={active} toolsUsed={toolsUsed(run.sections)} finished={run.done} />
        )}
      </Container>
    </Box>
  );
}
