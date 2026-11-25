import { useState } from "react";
import { Alert, Box, Button, Chip, LinearProgress, Stack, TextField, Typography } from "@mui/material";
import { api, Campaign } from "../api";
import { toolLabel } from "../labels";
import { loadAgents, roleChanged, SavedAgent, VariableKey, withNewInputs } from "../savedAgents";

const demoPrompt = `Find 5 software engineers near Kajang, Selangor, Malaysia.
They need at least 3 years of experience and strong C# and .NET.
React or Angular, SQL Server, REST APIs and Docker are expected.
Microservices, Azure, CI/CD and IoT are a bonus.`;

async function createAndStart(body: Record<string, unknown>) {
  const created = await api.post<Campaign>("/campaigns", body);
  const started = await api.post<Campaign>(`/campaigns/${created.data.id}/start`);
  return started.data;
}

function AgentPanel({ agent, busy, onRun }: {
  agent: SavedAgent; busy: boolean; onRun: (values: Record<VariableKey, string>) => void;
}) {
  const [values, setValues] = useState(
    () => Object.fromEntries(agent.variables.map((v) => [v.key, v.value])) as Record<VariableKey, string>,
  );
  return (
    <Box sx={{ gridColumn: "1 / -1", bgcolor: "background.paper", border: "2px solid", borderColor: "primary.main", borderRadius: 1, p: { xs: 2, md: 3 } }}>
      <Box className="brief-grid">
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5">{agent.name}</Typography>
            <Typography color="text.secondary">Change the inputs and run. The saved steps are reused, so the AI goes straight to searching.</Typography>
          </Box>
          {agent.variables.map((v) => (
            <TextField key={v.key} id={`var-${v.key}`} label={v.label} value={values[v.key]}
              type={v.key === "candidates_wanted" ? "number" : "text"}
              helperText={v.key === "mandatory" ? "Separate with commas" : undefined}
              onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />
          ))}
          {roleChanged(agent, values) && (
            <Typography variant="body2" color="warning.main">Role changed: the agent will re-think its requirements and plan.</Typography>
          )}
          <Button variant="contained" size="large" disabled={busy || !values.job_title.trim()}
            onClick={() => onRun(values)} sx={{ alignSelf: "flex-start", px: 4 }}>
            {busy ? "Starting..." : "Run this agent"}
          </Button>
        </Stack>
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>Saved steps</Typography>
          <Box component="ol" sx={{ m: 0, pl: 3, display: "grid", gap: 1 }}>
            {agent.plan.map((step) => (
              <li key={step.step}>
                <Chip size="small" label={step.tool === "none" ? "Think" : toolLabel(step.tool)} sx={{ mr: 1 }} />
                <Typography component="span" variant="body2" color="text.secondary">{step.purpose}</Typography>
              </li>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function PromptView({ onStarted }: { onStarted: (campaign: Campaign) => void }) {
  const [prompt, setPrompt] = useState(demoPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agents] = useState<SavedAgent[]>(loadAgents);
  const [openId, setOpenId] = useState<string>();

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      onStarted(await createAndStart(body));
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || "Could not reach the agent. Check that the backend is running, then try again.");
    } finally {
      setBusy(false);
    }
  }

  function runAgent(agent: SavedAgent, values: Record<VariableKey, string>) {
    const { requirements, plan, count } = withNewInputs(agent, values);
    const adapt = roleChanged(agent, values);
    run({
      job_title: requirements.job_title,
      location: requirements.location,
      // An adapted run re-reads the brief, so send the original one for context.
      job_description: adapt ? agent.prompt : `Re-run of the saved agent "${agent.name}".`,
      minimum_candidates: count,
      saved_requirements: requirements,
      saved_plan: plan,
      adapt,
    });
  }

  return (
    <Stack spacing={7}>
      <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
        <Box>
          <Typography variant="h2" sx={{ fontSize: { xs: "2.2rem", md: "3.2rem" }, lineHeight: 1.05 }}>
            Who are you looking for?
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: "60ch", fontSize: "1.05rem" }}>
            Describe it in your own words. The agent works out what you need, plans its own search, and shows its thinking while it works.
          </Typography>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField id="prompt" label="Your request" multiline minRows={5} value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          InputProps={{ sx: { fontSize: "1.1rem", lineHeight: 1.6, bgcolor: "background.paper" } }} />
        <Button variant="contained" size="large" disabled={busy || !prompt.trim()}
          onClick={() => run({ job_description: prompt, minimum_candidates: 5 })}
          sx={{ alignSelf: "flex-start", px: 4, py: 1.5, fontSize: "1.05rem" }}>
          {busy && !openId ? "Starting..." : "Run"}
        </Button>
        {busy && <LinearProgress />}
      </Stack>

      <Box>
        <Typography variant="h5" sx={{ mb: 0.5 }}>My agents</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Runs you saved. Each one remembers its steps and asks only for the inputs that change.
        </Typography>
        {agents.length === 0 ? (
          <Typography color="text.secondary" sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, p: 2, maxWidth: 900 }}>
            No saved agents yet. Run a request, and if you like the result, save it as an agent from the Results step.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 2 }}>
            {agents.flatMap((agent) => {
              const isOpen = openId === agent.id;
              const card = (
                <Box key={agent.id} component="button" onClick={() => setOpenId(isOpen ? undefined : agent.id)} aria-expanded={isOpen}
                  sx={{ all: "unset", cursor: "pointer", p: 2, bgcolor: "background.paper", border: "1px solid", borderRadius: 1, display: "grid", gap: 1,
                    borderColor: isOpen ? "primary.main" : "divider", "&:hover, &:focus-visible": { borderColor: "primary.main" } }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{agent.name}</Typography>
                    <Chip size="small" label={`v${agent.version}`} />
                    <Typography variant="body2" color="warning.main" aria-label={`${agent.rating} stars`}>{"★".repeat(agent.rating)}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {agent.variables.filter((v) => v.key !== "mandatory").map((v) => (
                      <Chip key={v.key} size="small" variant="outlined" label={v.value} />
                    ))}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {agent.variables.length} inputs, {agent.plan.length} saved steps
                  </Typography>
                </Box>
              );
              return isOpen
                ? [card, <AgentPanel key={`${agent.id}-panel`} agent={agent} busy={busy} onRun={(values) => runAgent(agent, values)} />]
                : [card];
            })}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
