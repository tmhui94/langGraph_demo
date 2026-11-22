import { Box, Typography } from "@mui/material";
import { STAGES, StageNode, toolLabel } from "../labels";
import { StageStatus } from "../useAgentRun";

interface PlanStep { step: number; tool: string; purpose: string; done: boolean }

function Dot({ status }: { status: StageStatus }) {
  const base = {
    width: 16, height: 16, borderRadius: "50%", flex: "none", mt: "3px", boxSizing: "border-box",
    display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700,
  } as const;
  if (status === "done") return <Box sx={{ ...base, bgcolor: "primary.main", color: "#fff" }}>✓</Box>;
  if (status === "failed") return <Box sx={{ ...base, bgcolor: "error.main", color: "#fff" }}>!</Box>;
  if (status === "active") return <Box sx={{ ...base, bgcolor: "secondary.main", border: "2px solid", borderColor: "primary.main" }} />;
  return <Box sx={{ ...base, border: "2px solid", borderColor: "divider", bgcolor: "background.paper" }} />;
}

/** The real LangGraph nodes as a vertical rail. The agent's own plan hangs under "Plan". */
export default function GraphSpine({ statuses, agentSteps, plan }: {
  statuses: Record<StageNode, StageStatus>; agentSteps: number; plan: PlanStep[];
}) {
  return (
    <Box component="nav" aria-label="Agent progress" className="sticky">
      <Typography variant="h6" sx={{ mb: 2 }}>The agent's route</Typography>
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {STAGES.map((stage, i) => {
          const status = statuses[stage.node];
          return (
            <Box component="li" key={stage.node} sx={{ position: "relative", pl: 3.5, pb: 2.5 }}>
              {i < STAGES.length - 1 && (
                <Box sx={{ position: "absolute", left: 7, top: 22, bottom: 0, width: 2,
                  bgcolor: status === "done" ? "primary.main" : "divider" }} />
              )}
              <Box sx={{ position: "absolute", left: 0, top: 0 }}><Dot status={status} /></Box>
              <Typography component="span" fontWeight={status === "waiting" ? 500 : 700}
                color={status === "waiting" ? "text.secondary" : "text.primary"}
                className={status === "active" ? "hl" : undefined}
                sx={{ fontFamily: "var(--display)", fontSize: "1.05rem", px: 0.25 }}>
                {stage.title}
              </Typography>
              {stage.node === "agent" && agentSteps > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {agentSteps} {agentSteps === 1 ? "step" : "steps"} so far
                </Typography>
              )}
              {stage.node === "plan" && plan.length > 0 && (
                <Box component="ul" sx={{ listStyle: "none", m: 0, mt: 1, p: 0, display: "grid", gap: 0.75 }}>
                  {plan.map((step) => (
                    <Box component="li" key={step.step} sx={{ display: "flex", gap: 1, alignItems: "baseline" }} title={step.purpose}>
                      <Box sx={{ width: 10, height: 10, borderRadius: "2px", flex: "none", border: "2px solid",
                        borderColor: "primary.main", bgcolor: step.done ? "primary.main" : "transparent" }} />
                      <Typography variant="body2" color={step.done ? "text.primary" : "text.secondary"}>
                        {step.tool === "none" ? "Think it through" : toolLabel(step.tool)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
