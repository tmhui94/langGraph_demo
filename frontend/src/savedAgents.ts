// Saved agents live in this browser only (localStorage). Demo scope: no backend.

export interface SavedAgent {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  rating: number;
  sourceCampaignId: string;
  jobTitle: string;
  location: string;
  jobDescription: string;
  minimumCandidates: number;
  plan: { step: number; tool: string; purpose: string }[];
  toolsUsed: string[];
  result: { found: number; high: number; medium: number; low: number };
}

const KEY = "savedAgents";

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
    .filter((agent) => agent.name.trim().toLowerCase() === draft.name.trim().toLowerCase())
    .reduce((max, agent) => Math.max(max, agent.version), 0) + 1;
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
  return loadAgents().find((agent) => agent.sourceCampaignId === campaignId);
}
