import { useEffect, useRef, useState } from "react";
import { Box, Chip, Collapse, Stack, Typography } from "@mui/material";
import ReportView from "../ReportView";
import { toolLabel } from "../labels";
import { Block, Call, Section } from "../useAgentRun";

function tryJson(text: string): any {
  try { return JSON.parse(text); } catch { return undefined; }
}

function pretty(text: string) {
  const parsed = tryJson(text);
  return parsed === undefined ? text : JSON.stringify(parsed, null, 2);
}

function Reasoning({ block }: { block: Block }) {
  const [open, setOpen] = useState(true);
  return (
    <Box sx={{ borderLeft: "4px solid var(--marker)", pl: 1.75, py: 0.25 }}>
      <Box component="button" onClick={() => setOpen(!open)} aria-expanded={open}
        sx={{ all: "unset", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", color: "text.secondary" }}>
        {block.done ? "How it reasoned" : "Thinking"} {open ? "(hide)" : "(show)"}
      </Box>
      <Collapse in={open}>
        <Typography variant="body2" className={!block.done ? "caret" : undefined}
          sx={{ whiteSpace: "pre-wrap", color: "text.secondary", fontStyle: "italic", mt: 0.5 }}>
          {block.text}
        </Typography>
      </Collapse>
    </Box>
  );
}

function inputSummary(call: Call): string {
  const i = call.input;
  return String(i.query ?? i.url ?? i.name ?? (i.candidate_id ? "candidate " + String(i.candidate_id).slice(0, 8) : ""));
}

function ToolRow({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const status = call.result === undefined ? "running" : call.isError ? "error" : "ok";
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
      <Box component="button" onClick={() => setOpen(!open)} aria-expanded={open}
        sx={{ all: "unset", cursor: "pointer", display: "flex", gap: 1, alignItems: "center", p: 1, width: "100%", boxSizing: "border-box" }}>
        <Chip size="small" color="primary" label={toolLabel(call.tool)} />
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
          {inputSummary(call)}
        </Typography>
        <Chip size="small" variant="outlined" label={status === "running" ? "working" : status}
          color={status === "error" ? "error" : status === "ok" ? "success" : "default"} />
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 1.5, pb: 1.5, display: "grid", gap: 1 }}>
          <Typography variant="body2" fontWeight={600}>What it asked for</Typography>
          <Typography component="pre" sx={{ m: 0, fontFamily: "var(--mono)", fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(call.input, null, 2)}
          </Typography>
          {call.result !== undefined && (
            <>
              <Typography variant="body2" fontWeight={600}>What came back</Typography>
              <Typography component="pre" sx={{ m: 0, fontFamily: "var(--mono)", fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflow: "auto" }}>
                {pretty(call.result)}
              </Typography>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function Requirements({ text }: { text: string }) {
  const data = tryJson(text) as Record<string, string[]> | undefined;
  if (!data) return <Typography component="pre" sx={{ m: 0, fontFamily: "var(--mono)", fontSize: "0.78rem", whiteSpace: "pre-wrap" }}>{text}</Typography>;
  return (
    <Stack spacing={1.25}>
      {Object.entries(data).map(([key, values]) => (
        <Box key={key}>
          <Typography variant="body2" fontWeight={600} sx={{ textTransform: "capitalize" }}>{key.replace(/_/g, " ")}</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {values.map((v) => <Chip key={v} size="small" label={v} />)}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

const TITLES: Record<string, string> = {
  understand: "Understand the brief",
  discover_tools: "Discover tools",
  plan: "Plan",
  report: "Write the report",
};

function titleOf(s: Section) {
  return s.node === "agent" ? `Act, step ${s.step}` : TITLES[s.node] ?? s.node;
}

function summaryOf(s: Section, live: boolean): string {
  const blocks = Object.values(s.blocks);
  const text = blocks.find((b) => b.kind === "text");
  switch (s.node) {
    case "understand": {
      const data = text?.done ? tryJson(text.text) : undefined;
      return data ? `${data.mandatory?.length ?? 0} must-haves, ${data.technical_skills?.length ?? 0} skills found` : "Reading the brief";
    }
    case "discover_tools": return s.tools ? `${s.tools.length} tools available` : "Checking tools";
    case "plan": return s.plan ? `${s.plan.length} steps planned` : "Drafting a plan";
    case "report": return text?.done ? "Briefing written" : "Writing the briefing";
    default: {
      const say = text?.text.trim();
      if (say) return say.length > 150 ? say.slice(0, 150) + "..." : say;
      return live ? "Thinking" : "Used tools";
    }
  }
}

function StepBody({ section }: { section: Section }) {
  const blocks = Object.entries(section.blocks).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <Stack spacing={1.5} sx={{ pt: 1.5 }}>
      {section.tools && (
        <Stack spacing={0.75}>
          {section.tools.map((t) => (
            <Box key={t.name}>
              <Chip size="small" color="primary" variant="outlined" label={toolLabel(t.name)} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{t.description}</Typography>
            </Box>
          ))}
        </Stack>
      )}
      {blocks.map(([index, block]) => {
        if (block.kind === "thinking") return <Reasoning key={index} block={block} />;
        if (section.node === "understand") return <Requirements key={index} text={block.text} />;
        if (section.node === "plan") return section.plan ? null : (
          <Typography key={index} component="pre" sx={{ m: 0, fontFamily: "var(--mono)", fontSize: "0.78rem", whiteSpace: "pre-wrap" }}>{block.text}</Typography>
        );
        if (section.node === "report") return <ReportView key={index} markdown={block.text} done={block.done} />;
        return <Typography key={index} sx={{ whiteSpace: "pre-wrap" }} className={!block.done ? "caret" : undefined}>{block.text}</Typography>;
      })}
      {section.plan && (
        <Box component="ol" sx={{ m: 0, pl: 3, display: "grid", gap: 0.75 }}>
          {section.plan.map((p) => (
            <li key={p.step}>
              <Typography variant="body2">
                <Chip size="small" label={p.tool === "none" ? "Think" : toolLabel(p.tool)} sx={{ mr: 1 }} />{p.purpose}
              </Typography>
            </li>
          ))}
        </Box>
      )}
      {section.calls.map((call) => <ToolRow key={call.id} call={call} />)}
    </Stack>
  );
}

function StepBlock({ section, open, live, onToggle }: {
  section: Section; open: boolean; live: boolean; onToggle: () => void;
}) {
  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1.75 }}>
      <Box component="button" onClick={onToggle} aria-expanded={open}
        sx={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
        <Typography component="span" className={live ? "hl" : undefined}
          sx={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.15rem", px: 0.25 }}>
          {titleOf(section)}
        </Typography>
        {!open && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} className="line-clamp-2">
              {summaryOf(section, live)}
            </Typography>
            {section.calls.length > 0 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                {section.calls.map((c) => <Chip key={c.id} size="small" variant="outlined" label={toolLabel(c.tool)} />)}
              </Stack>
            )}
          </>
        )}
      </Box>
      {open && <StepBody section={section} />}
    </Box>
  );
}

/** The newest step is open and streaming; earlier steps fold to one line and reopen on click. */
export default function ThoughtStream({ sections, lastSeq, done }: { sections: Section[]; lastSeq: number; done: boolean }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!done) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastSeq, done]);

  if (sections.length === 0) {
    return <Typography color="text.secondary">Connecting to the agent...</Typography>;
  }
  return (
    <Box>
      {sections.map((section, i) => {
        const isLast = i === sections.length - 1;
        const open = overrides[section.key] ?? isLast;
        return (
          <StepBlock key={section.key} section={section} open={open} live={isLast && !done}
            onToggle={() => setOverrides({ ...overrides, [section.key]: !open })} />
        );
      })}
      <div ref={end} />
    </Box>
  );
}
