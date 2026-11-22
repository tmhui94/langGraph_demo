import { useEffect, useMemo, useState } from "react";
import {
  AppBar, Box, Button, Card, CardContent, Chip, Container, Dialog, DialogContent,
  DialogTitle, Grid, MenuItem, Stack, Tab, Tabs, TextField, Toolbar, Typography,
  Alert, LinearProgress, Link,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { BarChart, Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Campaign, Candidate, Evaluation } from "./api";
import LiveExecution from "./LiveExecution";
import { loadAgents, SavedAgent } from "./savedAgents";

const demoDescription = `Software Engineer in Kajang / Selangor, Malaysia.
Minimum 3 years of software development experience. Strong C# and .NET experience.
Experience with React or Angular, SQL Server, REST API development, and Docker.
Familiarity with Docker. Preferred: microservices architecture, Azure, CI/CD, and IoT integration.`;

function Metric({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ color }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

function Dashboard({ campaigns }: { campaigns: Campaign[] }) {
  const candidates = campaigns.flatMap((campaign) => campaign.candidates);
  const evaluations = campaigns.flatMap((campaign) => campaign.evaluations);
  const counts = ["HIGH", "MEDIUM", "LOW"].map((category) => ({
    category,
    count: evaluations.filter((item) => item.category === category).length,
  }));
  return (
    <Stack spacing={3}>
      <Typography variant="h5">Recruitment Dashboard</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><Metric label="Sourcing campaigns" value={campaigns.length} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric label="Candidates discovered" value={candidates.length} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric label="Candidates evaluated" value={evaluations.length} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric label="Active sourcing jobs" value={campaigns.filter((item) => !["DRAFT", "COMPLETED", "FAILED"].includes(item.status)).length} /></Grid>
      </Grid>
      <Card>
        <CardContent>
          <Typography variant="h6" mb={2}>Candidate suitability distribution</Typography>
          <Box height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={counts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#176B87" name="Candidates" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}

function CreateCampaign({ onCreated }: { onCreated: (campaign: Campaign) => void }) {
  const [jobTitle, setJobTitle] = useState("Software Engineer");
  const [location, setLocation] = useState("Kajang / Selangor, Malaysia");
  const [description, setDescription] = useState(demoDescription);
  const [minimum, setMinimum] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agents] = useState<SavedAgent[]>(loadAgents);
  const [usingAgent, setUsingAgent] = useState<SavedAgent>();

  function applyAgent(agent: SavedAgent) {
    setJobTitle(agent.jobTitle);
    setLocation(agent.location);
    setDescription(agent.jobDescription);
    setMinimum(agent.minimumCandidates);
    setUsingAgent(agent);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const created = await api.post<Campaign>("/campaigns", {
        job_title: jobTitle,
        job_description: description,
        location,
        minimum_candidates: minimum,
      });
      const started = await api.post<Campaign>(`/campaigns/${created.data.id}/start`);
      onCreated(started.data); // the run continues in the background; the Live tab streams it
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || "Could not start the sourcing campaign.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} maxWidth={900}>
      <Typography variant="h5">Create Sourcing Campaign</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {busy && <LinearProgress />}
      {agents.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h6">My agents</Typography>
          <Grid container spacing={2}>
            {agents.map((agent) => (
              <Grid item xs={12} md={6} key={agent.id}>
                <Card variant="outlined" sx={{ height: "100%", borderColor: usingAgent?.id === agent.id ? "primary.main" : undefined }}>
                  <CardContent>
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography fontWeight={700}>{agent.name}</Typography>
                        <Chip size="small" label={`v${agent.version}`} />
                        <Typography variant="body2" color="warning.main">{"★".repeat(agent.rating)}</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Last result: {agent.result.found} found · {agent.result.high} HIGH · {agent.result.medium} MEDIUM ·
                        {" "}{agent.result.low} LOW · plan of {agent.plan.length} steps
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {agent.toolsUsed.map((tool) => <Chip key={tool} size="small" variant="outlined" label={`🔧 ${tool}`} />)}
                      </Stack>
                      <Button size="small" variant="outlined" sx={{ alignSelf: "flex-start" }} onClick={() => applyAgent(agent)}>
                        Use this agent
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          {usingAgent && (
            <Alert severity="info">
              Loaded <strong>{usingAgent.name}</strong> (v{usingAgent.version}). Adjust the inputs if needed, then start.
            </Alert>
          )}
        </Stack>
      )}
      <TextField label="Job title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
      <TextField label="Location" value={location} onChange={(event) => setLocation(event.target.value)} />
      <TextField label="Job description" multiline minRows={8} value={description} onChange={(event) => setDescription(event.target.value)} />
      <TextField label="Minimum candidate count" type="number" value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} />
      <Button variant="contained" onClick={submit} disabled={busy} sx={{ alignSelf: "flex-start" }}>
        Start AI agent
      </Button>
    </Stack>
  );
}

function CandidateProfile({ candidate, evaluation, open, onClose }: {
  candidate?: Candidate; evaluation?: Evaluation; open: boolean; onClose: () => void;
}) {
  if (!candidate) return null;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{candidate.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pb={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {evaluation && <Chip label={`${evaluation.category} — ${evaluation.total_score}`} color={evaluation.category === "HIGH" ? "success" : evaluation.category === "MEDIUM" ? "warning" : "default"} />}
            <Chip label={candidate.resume_available ? "Resume available" : "Resume not found"} />
          </Stack>
          <Typography><strong>Current role:</strong> {candidate.current_title}</Typography>
          <Typography><strong>Company:</strong> {candidate.current_company}</Typography>
          <Typography><strong>Location:</strong> {candidate.location}</Typography>
          {candidate.summary && <Typography>{candidate.summary}</Typography>}
          {(evaluation?.strengths?.length ?? 0) > 0 && <>
            <Typography variant="h6">Strengths</Typography>
            {evaluation?.strengths?.map((item) => <Typography key={item}>• {item}</Typography>)}
          </>}
          {(evaluation?.weaknesses?.length ?? 0) > 0 && <>
            <Typography variant="h6">Gaps / review items</Typography>
            {evaluation?.weaknesses?.map((item) => <Typography key={item}>• {item}</Typography>)}
          </>}
          <Typography variant="h6">Evidence and sources</Typography>
          {candidate.sources.map((source) => (
            <Link key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</Link>
          ))}
          {evaluation?.criterion_scores.map((score) => (
            <Card variant="outlined" key={score.name}>
              <CardContent>
                <Typography><strong>{score.name}</strong>: {score.score}/100 ({score.weighted_score} weighted)</Typography>
                {score.evidence.map((item) => <Typography variant="body2" key={item}>Evidence: {item}</Typography>)}
                {score.missing_information.map((item) => <Typography variant="body2" color="text.secondary" key={item}>{item}</Typography>)}
              </CardContent>
            </Card>
          ))}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" color="success">Mark shortlisted</Button>
            <Button variant="outlined">Mark for review</Button>
            <Button color="error">Reject with decision</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function CandidateResults({ campaign }: { campaign?: Campaign }) {
  const [selected, setSelected] = useState<{ candidate: Candidate; evaluation?: Evaluation }>();
  const candidates = campaign?.candidates || [];
  const evaluations = campaign?.evaluations || [];
  const evaluationById = useMemo(() => new Map(evaluations.map((item) => [item.candidate_id, item])), [evaluations]);
  const rows = candidates.map((candidate) => {
    const evaluation = evaluationById.get(candidate.id);
    return { ...candidate, score: evaluation?.total_score ?? 0, category: evaluation?.category ?? "LOW" };
  });
  const columns: GridColDef[] = [
    { field: "name", headerName: "Candidate", flex: 1, minWidth: 160 },
    { field: "current_title", headerName: "Designation", flex: 1, minWidth: 150 },
    { field: "current_company", headerName: "Company", flex: 1, minWidth: 140 },
    { field: "location", headerName: "Location", flex: 1, minWidth: 150 },
    { field: "score", headerName: "Score", width: 100, type: "number" },
    { field: "category", headerName: "Category", width: 120 },
    { field: "linkedin_url", headerName: "LinkedIn", flex: 1, minWidth: 130,
      renderCell: (params) => params.value ? <Link href={params.value} target="_blank">Profile</Link> : "Not Found" },
  ];
  return (
    <Stack spacing={2} height="calc(100vh - 180px)">
      <Typography variant="h5">Candidate Results</Typography>
      {campaign?.limitation && <Alert severity="warning">{campaign.limitation}</Alert>}
      <DataGrid
        rows={rows}
        columns={columns}
        pageSizeOptions={[10, 20, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
        onRowClick={(params) => setSelected({
          candidate: params.row,
          evaluation: evaluationById.get(params.row.id),
        })}
      />
      <CandidateProfile
        open={Boolean(selected)}
        candidate={selected?.candidate}
        evaluation={selected?.evaluation}
        onClose={() => setSelected(undefined)}
      />
    </Stack>
  );
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  async function load() {
    try {
      const response = await api.get<Campaign[]>("/campaigns");
      setCampaigns(response.data);
    } catch {
      setCampaigns([]);
    }
  }

  useEffect(() => { load(); }, []);
  const active = campaigns[0];

  return (
    <Box>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>HR Candidate Intelligence</Typography>
          <Chip label="Human decision required" variant="outlined" sx={{ color: "white", borderColor: "rgba(255,255,255,.5)" }} />
        </Toolbar>
      </AppBar>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 2, bgcolor: "white" }}>
        <Tab label="Dashboard" />
        <Tab label="Create Campaign" />
        <Tab label="Live Execution" />
        <Tab label="Candidates" />
      </Tabs>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {tab === 0 && <Dashboard campaigns={campaigns} />}
        {tab === 1 && <CreateCampaign onCreated={(campaign) => { setCampaigns((items) => [campaign, ...items.filter((item) => item.id !== campaign.id)]); setTab(2); }} />}
        {tab === 2 && <LiveExecution campaign={active} onDone={load} />}
        {tab === 3 && <CandidateResults campaign={active} />}
      </Container>
    </Box>
  );
}
