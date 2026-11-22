import { useState } from "react";
import { Alert, Box, Button, Chip, LinearProgress, Stack, TextField, Typography } from "@mui/material";
import { api, Campaign } from "../api";
import { STAGES, TOOLS } from "../labels";
import { loadAgents, SavedAgent } from "../savedAgents";

const demoDescription = `Software Engineer in Kajang / Selangor, Malaysia.
Minimum 3 years of software development experience. Strong C# and .NET experience.
Experience with React or Angular, SQL Server, REST API development, and Docker.
Preferred: microservices architecture, Azure, CI/CD, and IoT integration.`;

const statusLabel = (status: string) =>
  status === "COMPLETED" ? "Finished" : status === "FAILED" ? "Failed" : status === "DRAFT" ? "Draft" : "Running";

export default function BriefView({ campaigns, onStarted, onOpen }: {
  campaigns: Campaign[];
  onStarted: (campaign: Campaign) => void;
  onOpen: (campaign: Campaign) => void;
}) {
  const [jobTitle, setJobTitle] = useState("Software Engineer");
  const [location, setLocation] = useState("Kajang / Selangor, Malaysia");
  const [description, setDescription] = useState(demoDescription);
  const [minimum, setMinimum] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agents] = useState<SavedAgent[]>(loadAgents);
  const [loaded, setLoaded] = useState<SavedAgent>();

  function applyAgent(agent: SavedAgent) {
    setJobTitle(agent.jobTitle);
    setLocation(agent.location);
    setDescription(agent.jobDescription);
    setMinimum(agent.minimumCandidates);
    setLoaded(agent);
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const created = await api.post<Campaign>("/campaigns", {
        job_title: jobTitle, job_description: description, location, minimum_candidates: minimum,
      });
      const started = await api.post<Campaign>(`/campaigns/${created.data.id}/start`);
      onStarted(started.data);
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || "Could not reach the agent. Check that the backend is running, then try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={7}>
      <Box className="brief-grid">
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h2" sx={{ fontSize: { xs: "2.2rem", md: "3.2rem" }, lineHeight: 1.05 }}>
              Who are you looking for?
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: "55ch", fontSize: "1.05rem" }}>
              Describe the role. The agent reads it, plans its own search, and shows its thinking while it works.
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {loaded && <Alert severity="info">Loaded <strong>{loaded.name}</strong> (v{loaded.version}). Adjust anything, then start.</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField id="job-title" label="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} fullWidth />
            <TextField id="location" label="Location" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth />
          </Stack>
          <TextField id="description" label="Job description" multiline minRows={7} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField id="minimum" label="Candidates to find" type="number" value={minimum} sx={{ width: 180 }}
              inputProps={{ min: 1, max: 50 }} helperText="Fewer finishes faster"
              onChange={(e) => setMinimum(Math.max(1, Number(e.target.value)))} />
            <Button variant="contained" size="large" onClick={start} disabled={busy || !jobTitle.trim() || !description.trim()}
              sx={{ px: 4, py: 1.5, fontSize: "1.05rem", alignSelf: "flex-start" }}>
              {busy ? "Starting..." : "Start the agent"}
            </Button>
          </Stack>
          {busy && <LinearProgress />}
        </Stack>

        <Box>
          <Typography variant="h5" sx={{ mb: 2 }}>How the agent works</Typography>
          <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 2 }}>
            {STAGES.map((stage, i) => (
              <Box component="li" key={stage.node} sx={{ display: "grid", gridTemplateColumns: "2rem minmax(0,1fr)", gap: 1.5 }}>
                <Typography sx={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.4rem", lineHeight: 1.1 }}>{i + 1}</Typography>
                <Box>
                  <Typography fontWeight={600}>{stage.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{stage.blurb}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Tools it can use</Typography>
          <Stack spacing={1}>
            {TOOLS.map((tool) => (
              <Box key={tool.name}>
                <Chip size="small" color="primary" label={tool.label} sx={{ mr: 1 }} />
                <Typography component="span" variant="body2" color="text.secondary">{tool.blurb}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

      {agents.length > 0 && (
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5 }}>My agents</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>Runs you rated well and saved. Load one to reuse its inputs.</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 2 }}>
            {agents.map((agent) => (
              <Box key={agent.id} sx={{ p: 2, bgcolor: "background.paper", border: "1px solid", borderColor: loaded?.id === agent.id ? "primary.main" : "divider", borderRadius: 1, display: "grid", gap: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography fontWeight={700}>{agent.name}</Typography>
                  <Chip size="small" label={`v${agent.version}`} />
                  <Typography variant="body2" color="warning.main" aria-label={`${agent.rating} stars`}>{"★".repeat(agent.rating)}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Last time: {agent.result.found} found, {agent.result.high} high, {agent.result.medium} medium, {agent.result.low} low.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => applyAgent(agent)} sx={{ justifySelf: "start" }}>Load this agent</Button>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {campaigns.length > 0 && (
        <Box>
          <Typography variant="h5" sx={{ mb: 1 }}>Recent runs</Typography>
          <Stack>
            {campaigns.slice(0, 6).map((c) => (
              <Stack key={c.id} direction="row" spacing={2} alignItems="center" sx={{ py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={600} noWrap>{c.job_title}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{c.location}</Typography>
                </Box>
                <Chip size="small" variant="outlined" label={statusLabel(c.status)}
                  color={c.status === "COMPLETED" ? "success" : c.status === "FAILED" ? "error" : "default"} />
                <Typography variant="body2" color="text.secondary" sx={{ width: 90, textAlign: "right" }}>
                  {c.evaluations.length} scored
                </Typography>
                <Button size="small" onClick={() => onOpen(c)}>Open</Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
