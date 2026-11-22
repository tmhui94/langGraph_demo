import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

export interface Candidate {
  id: string;
  name: string;
  current_title: string;
  current_company: string;
  location: string;
  linkedin_url?: string;
  github_url?: string;
  resume_available: boolean;
  summary?: string;
  skills: string[];
  sources: { url: string; title: string; retrieved_at: string }[];
  evidence_status: string;
}

export interface Evaluation {
  candidate_id: string;
  total_score: number;
  category: "HIGH" | "MEDIUM" | "LOW";
  criterion_scores: { name: string; score: number; weighted_score: number; evidence: string[]; missing_information: string[] }[];
  strengths: string[];
  weaknesses: string[];
  knockout_findings: string[];
  recruiter_review_required: boolean;
}

export interface Requirements {
  job_title: string;
  location: string;
  candidates_wanted: number;
  mandatory: string[];
  preferred: string[];
  technical_skills: string[];
  industries: string[];
  alternative_titles: string[];
  knockout_criteria: string[];
  search_queries?: string[];
}

export interface Campaign {
  id: string;
  job_title: string;
  job_description: string;
  location: string;
  minimum_candidates: number;
  status: string;
  candidates: Candidate[];
  evaluations: Evaluation[];
  events: { node: string; status: string; detail: string; timestamp: string }[];
  limitation: string;
  plan: { step: number; tool: string; purpose: string }[];
  summary: string;
  requirements?: Requirements | null;
  reused?: boolean;
  created_at: string;
}

export interface AgentEvent {
  seq: number;
  timestamp?: string;
  type:
    | "node_start" | "node_end" | "tools_available" | "plan"
    | "block_start" | "thinking_delta" | "text_delta" | "block_end"
    | "tool_call" | "tool_result" | "reused" | "error" | "done";
  node?: string;
  step?: number | null;
  label?: string;
  block?: number;
  kind?: "thinking" | "text" | "tool_use";
  delta?: string;
  text?: string;
  id?: string;
  tool?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  content?: string;
  tools?: { name: string; description: string }[];
  steps?: { step: number; tool: string; purpose: string }[];
  detail?: string;
  status?: string;
}

/** Subscribe to the live agent event stream. The server replays history first. */
export function subscribeEvents(id: string, onEvent: (event: AgentEvent) => void): () => void {
  const source = new EventSource(`/api/campaigns/${id}/events`);
  source.onmessage = (message) => {
    const event: AgentEvent = JSON.parse(message.data);
    onEvent(event);
    if (event.type === "done") source.close();
  };
  return () => source.close();
}
