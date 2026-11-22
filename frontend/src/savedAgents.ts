// Saved agents live in this browser only (localStorage). Demo scope: no backend storage.
import { Campaign, Requirements } from "./api";

export type VariableKey = "job_title" | "location" | "candidates_wanted" | "mandatory";

export interface AgentVariable { key: VariableKey; label: string; value: string }
export interface PlanStep { step: number; tool: string; purpose: string }

export interface SavedAgent {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  rating: number;
  sourceCampaignId: string;
  prompt: string;
  variables: AgentVariable[];   // the inputs the agent asks for on a re-run
  requirements: Requirements;   // what the AI understood the first time
  plan: PlanStep[];             // the steps it worked out the first time
  toolsUsed: string[];
  result: { found: number; high: number; medium: number; low: number };
}

const KEY = "savedAgents.v2";

export function loadAgents(): SavedAgent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedAgent[]) : [];
  } catch {
    return [];
  }
}

export function saveAgent(draft: Omit<SavedAgent, "id" | "version" | "savedAt">): SavedAgent {
  const agents = loadAgents();
  const version = agents
    .filter((a) => a.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
    .reduce((max, a) => Math.max(max, a.version), 0) + 1;
  const agent: SavedAgent = {
    ...draft,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([agent, ...agents]));
  } catch {
    // Storage unavailable (private window etc.): the agent is still returned for this session.
  }
  return agent;
}

export function findByCampaign(campaignId: string): SavedAgent | undefined {
  return loadAgents().find((a) => a.sourceCampaignId === campaignId);
}

/** The parts of a request that can change between runs. */
export function variablesFrom(requirements: Requirements, campaign: Campaign): AgentVariable[] {
  return [
    { key: "job_title", label: "Job title", value: requirements.job_title || campaign.job_title },
    { key: "location", label: "Location", value: requirements.location || campaign.location },
    { key: "candidates_wanted", label: "How many candidates", value: String(requirements.candidates_wanted || campaign.minimum_candidates) },
    { key: "mandatory", label: "Must-haves", value: requirements.mandatory.join(", ") },
  ];
}

/** Puts new input values into the saved requirements and plan, ready for a re-run. */
export function withNewInputs(agent: SavedAgent, values: Record<VariableKey, string>) {
  const old = Object.fromEntries(agent.variables.map((v) => [v.key, v.value])) as Record<VariableKey, string>;
  const count = Math.max(1, Number(values.candidates_wanted) || 1);
  const requirements: Requirements = {
    ...agent.requirements,
    job_title: values.job_title.trim(),
    location: values.location.trim(),
    candidates_wanted: count,
    mandatory: values.mandatory.split(",").map((m) => m.trim()).filter(Boolean),
  };
  const swap = (text: string) =>
    (["job_title", "location"] as const).reduce(
      (out, key) => (old[key] && values[key] && old[key] !== values[key] ? out.split(old[key]).join(values[key]) : out),
      text,
    );
  const plan = agent.plan.map((step) => ({ ...step, purpose: swap(step.purpose) }));
  return { requirements, plan, count };
}
