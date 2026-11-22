import { useEffect, useReducer, useRef, useState } from "react";
import { AgentEvent, subscribeEvents } from "./api";
import { STAGES, StageNode } from "./labels";

export interface Block { kind: string; text: string; done: boolean }
export interface Call {
  id: string;
  tool: string;
  input: Record<string, any>;
  result?: string;
  isError?: boolean;
}
export interface Section {
  key: string;
  node: string;
  step?: number;
  running: boolean;
  blocks: Record<number, Block>;
  calls: Call[];
  tools?: { name: string; description: string }[];
  plan?: { step: number; tool: string; purpose: string }[];
}
export interface RunState {
  sections: Section[];
  lastSeq: number;
  done: boolean;
  error?: string;
  firstTs?: number;
  lastTs?: number;
}

export const initialRun: RunState = { sections: [], lastSeq: 0, done: false };

function sectionKey(node: string, step?: number | null) {
  return node === "agent" || node === "tools" ? `agent:${step ?? 0}` : node;
}

function parseTs(ts?: string) {
  // The server sends naive UTC timestamps.
  return ts ? Date.parse(ts + "Z") : undefined;
}

export function reducer(state: RunState, action: AgentEvent | { type: "reset" }): RunState {
  if (action.type === "reset") return initialRun;
  const e = action;
  if (e.seq <= state.lastSeq) return state; // replay after a reconnect

  const ts = parseTs(e.timestamp);
  const next: RunState = { ...state, lastSeq: e.seq, firstTs: state.firstTs ?? ts, lastTs: ts ?? state.lastTs };

  if (e.type === "error") return { ...next, error: e.detail };
  if (e.type === "done") return { ...next, done: true };
  if (!e.node || e.node === "start") return next;

  const key = sectionKey(e.node, e.step);
  const sections = [...state.sections];
  let index = sections.findIndex((s) => s.key === key);
  if (index === -1) {
    const isAgent = e.node === "agent" || e.node === "tools";
    sections.push({
      key,
      node: isAgent ? "agent" : e.node,
      step: isAgent ? e.step ?? 0 : undefined,
      running: false,
      blocks: {},
      calls: [],
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
      const block = section.blocks[e.block!] ?? {
        kind: e.type === "thinking_delta" ? "thinking" : "text", text: "", done: false,
      };
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

/** Subscribes to the live event stream of one campaign and folds it into RunState. */
export function useAgentRun(campaignId: string | undefined, onDone: () => void): RunState {
  const [state, dispatch] = useReducer(reducer, initialRun);
  const callback = useRef(onDone);
  callback.current = onDone;

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!campaignId) return;
    return subscribeEvents(campaignId, (event) => {
      dispatch(event);
      if (event.type === "done") callback.current();
    });
  }, [campaignId]);

  return state;
}

/** Seconds since the run started. Ticks while the run is live. */
export function useElapsedSeconds(state: RunState): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.done || state.firstTs === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.done, state.firstTs]);
  if (state.firstTs === undefined) return 0;
  const end = state.done ? state.lastTs ?? now : now;
  return Math.max(0, (end - state.firstTs) / 1000);
}

// ---- derived views ---------------------------------------------------------

export type StageStatus = "waiting" | "active" | "done" | "failed";

export function stageStatuses(state: RunState): Record<StageNode, StageStatus> {
  const order = STAGES.map((s) => s.node as string);
  const highest = state.sections.reduce((max, s) => Math.max(max, order.indexOf(s.node)), -1);
  const result = {} as Record<StageNode, StageStatus>;
  STAGES.forEach((stage, i) => {
    const current = Math.max(highest, 0);
    if (state.error && state.done) {
      result[stage.node] = i < current ? "done" : i === current ? "failed" : "waiting";
    } else if (state.done) {
      result[stage.node] = "done";
    } else {
      result[stage.node] = i < current ? "done" : i === current ? "active" : "waiting";
    }
  });
  return result;
}

export interface BoardCandidate {
  key: string;
  id?: string;
  name: string;
  title: string;
  company: string;
  location: string;
  url: string;
  score?: number;
  category?: "HIGH" | "MEDIUM" | "LOW";
  scoring: boolean;
}

function parse(text?: string): any {
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}

/** Candidates the agent has recorded and scored so far, built from tool activity. */
export function deriveCandidates(sections: Section[]): BoardCandidate[] {
  const calls = sections.flatMap((s) => s.calls);
  const board: BoardCandidate[] = [];

  for (const call of calls) {
    if (call.tool !== "record_candidate" || call.isError) continue;
    const result = parse(call.result);
    if (result?.duplicate) continue;
    board.push({
      key: call.id,
      id: result?.candidate_id,
      name: String(call.input.name ?? "Candidate"),
      title: String(call.input.current_title || ""),
      company: String(call.input.current_company || ""),
      location: String(call.input.location || ""),
      url: String(call.input.profile_url || ""),
      scoring: false,
    });
  }
  for (const call of calls) {
    if (call.tool !== "score_candidate") continue;
    const target = board.find((c) => c.id && c.id === call.input.candidate_id);
    if (!target) continue;
    if (call.result === undefined) { target.scoring = true; continue; }
    const result = parse(call.result);
    if (!call.isError && result) {
      target.score = result.total_score;
      target.category = result.category;
    }
  }
  return board;
}

export function planProgress(sections: Section[]) {
  const plan = sections.find((s) => s.node === "plan")?.plan ?? [];
  const used = new Set(sections.flatMap((s) => s.calls.map((c) => c.tool)));
  const acting = sections.some((s) => s.node === "agent");
  return plan.map((step) => ({ ...step, done: step.tool === "none" ? acting : used.has(step.tool) }));
}

export function countCalls(sections: Section[]) {
  return sections.reduce((sum, s) => sum + s.calls.length, 0);
}

export function toolsUsed(sections: Section[]) {
  return [...new Set(sections.flatMap((s) => s.calls.map((c) => c.tool)))];
}
