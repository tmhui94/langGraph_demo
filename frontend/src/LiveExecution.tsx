import { useEffect, useReducer, useRef, useState } from "react";
import {
  Alert, Box, Card, CardContent, Chip, Collapse, Stack, Step, StepLabel, Stepper, Typography,
} from "@mui/material";
import { AgentEvent, Campaign, subscribeEvents } from "./api";
import AgentFeedback from "./AgentFeedback";
import ReportView from "./ReportView";

interface Block { kind: string; text: string; done: boolean }
interface Call { id: string; tool: string; input: Record<string, unknown>; result?: string; isError?: boolean }
interface Section {
  key: string;
  node: string;
  step?: number;
  label: string;
  running: boolean;
  blocks: Record<number, Block>;
  calls: Call[];
  tools?: { name: string; description: string }[];
  plan?: { step: number; tool: string; purpose: string }[];
}
interface State { sections: Section[]; lastSeq: number; done: boolean; error?: string }

const STAGES = [
  { node: "understand", label: "Understand" },
  { node: "discover_tools", label: "Discover tools" },
  { node: "plan", label: "Plan" },
  { node: "agent", label: "Act" },
  { node: "report", label: "Report" },
];

const initial: State = { sections: [], lastSeq: 0, done: false };

function sectionKey(node: string, step?: number | null) {
  return node === "agent" || node === "tools" ? `agent:${step ?? 0}` : node;
}

function reducer(state: State, action: AgentEvent | { type: "reset" }): State {
  if (action.type === "reset") return initial;
  const e = action;
  if (e.seq <= state.lastSeq) return state; // replay after reconnect
  const next: State = { ...state, lastSeq: e.seq };

  if (e.type === "error") return { ...next, error: e.detail };
  if (e.type === "done") return { ...next, done: true };
  if (!e.node || e.node === "start") return next;

  const key = sectionKey(e.node, e.step);
  const sections = [...state.sections];
  let index = sections.findIndex((s) => s.key === key);
  if (index === -1) {
    const isAgent = e.node === "agent" || e.node === "tools";
    sections.push({
      key, node: isAgent ? "agent" : e.node, step: isAgent ? e.step ?? 0 : undefined,
      label: isAgent ? `Agent · step ${e.step}` : e.label || e.node,
      running: false, blocks: {}, calls: [],
    });
    index = sections.length - 1;
  }
  const section: Section = { ...sections[index], blocks: { ...sections[index].blocks } };
  sections[index] = section;

  switch (e.type) {
    case "node_start": section.running = true; break;
    case "node_end": section.running = false; break;
    case "tools_available": section.tools = e.tools; break;
    case "plan": section.plan = e.steps; break;
    case "block_start":
      if (e.kind !== "tool_use") section.blocks[e.block!] = { kind: e.kind!, text: "", done: false };
      break;
    case "thinking_delta":
    case "text_delta": {
      const block = section.blocks[e.block!] ?? { kind: e.type === "thinking_delta" ? "thinking" : "text", text: "", done: false };
      section.blocks[e.block!] = { ...block, text: block.text + (e.delta ?? "") };
      break;
    }
    case "block_end":
      section.blocks[e.block!] = { kind: e.kind!, text: e.text ?? "", done: true };
      break;
    case "tool_call":
      section.calls = [...section.calls, { id: e.id!, tool: e.tool!, input: e.input ?? {} }];
      break;
    case "tool_result":
      section.calls = section.calls.map((c) =>
        c.id === e.id ? { ...c, result: e.content, isError: e.is_error } : c);
      break;
  }
  return { ...next, sections };
}

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function Reasoning({ block }: { block: Block }) {
  const [open, setOpen] = useState(true);
  return (
    <Box sx={{ borderLeft: "3px solid #b39ddb", pl: 1.5, bgcolor: "#f6f3fb", borderRadius: 1, py: 0.5 }}>
      <Typography variant="caption" sx={{ cursor: "pointer", fontWeight: 700 }} onClick={() => setOpen(!open)}>
        🧠 Reasoning {block.done ? "" : "…"} {open ? "▾" : "▸"}
      </Typography>
      <Collapse in={open}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontStyle: "italic", color: "text.secondary" }}>
          {block.text}
        </Typography>
      </Collapse>
    </Box>
  );
}

function ToolCall({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ border: "1px solid #ddd", borderRadius: 1, p: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip size="small" color="primary" label={`🔧 ${call.tool}`} />
        {call.result === undefined
          ? <Typography variant="caption">running…</Typography>
          : <Chip size="small" color={call.isError ? "error" : "success"} label={call.isError ? "error" : "ok"} />}
      </Stack>
      <Typography component="pre" variant="caption" sx={{ m: 0, mt: 0.5, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
        {JSON.stringify(call.input, null, 2)}
      </Typography>
      {call.result !== undefined && (
        <>
          <Typography variant="caption" sx={{ cursor: "pointer", fontWeight: 700 }} onClick={() => setOpen(!open)}>
            Observation {open ? "▾" : "▸"}
          </Typography>
          <Collapse in={open}>
            <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", maxHeight: 260, overflow: "auto" }}>
              {pretty(call.result)}
            </Typography>
          </Collapse>
        </>
      )}
    </Box>
  );
}

function Requirements({ text }: { text: string }) {
  try {
    const data = JSON.parse(text) as Record<string, string[]>;
    return (
      <Stack spacing={1}>
        {Object.entries(data).map(([key, values]) => (
          <Box key={key}>
            <Typography variant="caption" fontWeight={700}>{key.replace(/_/g, " ")}</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {values.map((v) => <Chip key={v} size="small" label={v} />)}
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  } catch {
    return <Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap" }}>{text}</Typography>;
  }
}

function SectionCard({ section }: { section: Section }) {
  const blocks = Object.entries(section.blocks).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <Card variant="outlined" sx={{ borderColor: section.running ? "primary.main" : undefined }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography fontWeight={700}>{section.label}</Typography>
          <Chip size="small" label={section.running ? "running" : "done"} color={section.running ? "warning" : "success"} />
        </Stack>
        <Stack spacing={1.5}>
          {section.tools && (
            <Stack spacing={0.5}>
              <Typography variant="body2">The agent has {section.tools.length} tools available:</Typography>
              {section.tools.map((t) => (
                <Box key={t.name}>
                  <Chip size="small" color="primary" variant="outlined" label={`🔧 ${t.name}`} />
                  <Typography variant="caption" display="block" color="text.secondary">{t.description}</Typography>
                </Box>
              ))}
            </Stack>
          )}
          {blocks.map(([index, block]) => {
            if (block.kind === "thinking") return <Reasoning key={index} block={block} />;
            if (section.node === "plan") return section.plan ? null : (
              <Typography key={index} component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap" }}>{block.text}</Typography>
            );
            if (section.node === "understand") return <Requirements key={index} text={block.text} />;
            if (section.node === "report") return <ReportView key={index} markdown={block.text} done={block.done} />;
            return (
              <Typography key={index} sx={{ whiteSpace: "pre-wrap" }}>
                {section.node === "agent" ? "💬 " : ""}{block.text}
              </Typography>
            );
          })}
          {section.plan && (
            <Box component="ol" sx={{ m: 0, pl: 3 }}>
              {section.plan.map((p) => (
                <li key={p.step}>
                  <Typography variant="body2">
                    <Chip size="small" label={p.tool} sx={{ mr: 1 }} />{p.purpose}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
          {section.calls.map((call) => <ToolCall key={call.id} call={call} />)}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function LiveExecution({ campaign, onDone }: { campaign?: Campaign; onDone: () => void }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const bottom = useRef<HTMLDivElement>(null);
  const campaignId = campaign?.id;
  const draft = campaign?.status === "DRAFT";

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!campaignId || draft) return;
    return subscribeEvents(campaignId, (event) => {
      dispatch(event);
      if (event.type === "done") onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, draft]);

  useEffect(() => {
    // Follow the run live, and scroll once more when the feedback card appears at the end.
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.lastSeq, state.done, campaign?.status]);

  if (!campaign) return <Alert severity="info">Create a campaign to watch the agent work.</Alert>;

  const started = new Set(state.sections.map((s) => s.node));
  const steps = state.sections.filter((s) => s.node === "agent").length;
  const activeIndex = STAGES.reduce((acc, stage, i) => (started.has(stage.node) ? i : acc), -1);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Live Agent Execution</Typography>
      <Typography variant="body2" color="text.secondary">
        {campaign.job_title}, {campaign.location}. Status: {state.done ? campaign.status : "running"}
      </Typography>
      <Stepper activeStep={state.done ? STAGES.length : Math.max(activeIndex, 0)} alternativeLabel>
        {STAGES.map((stage) => (
          <Step key={stage.node}>
            <StepLabel>{stage.node === "agent" && steps ? `Act (${steps} steps)` : stage.label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {campaign.limitation && !state.error && <Alert severity="warning">{campaign.limitation}</Alert>}
      {state.sections.map((section) => <SectionCard key={section.key} section={section} />)}
      {state.done && !state.error && (
        <Alert severity="success">
          Done. Open the Candidates tab to review the scored profiles.
        </Alert>
      )}
      {state.done && !state.error && campaign.status === "COMPLETED" && (
        <AgentFeedback
          key={campaign.id}
          campaign={campaign}
          toolsUsed={[...new Set(state.sections.flatMap((s) => s.calls.map((c) => c.tool)))]}
        />
      )}
      <div ref={bottom} />
    </Stack>
  );
}
