export const STAGES = [
  { node: "understand", title: "Understand", blurb: "Reads the job brief and pulls out what matters." },
  { node: "discover_tools", title: "Discover tools", blurb: "Checks which tools it is allowed to use." },
  { node: "plan", title: "Plan", blurb: "Decides which tools to use, and in what order." },
  { node: "agent", title: "Act", blurb: "Reasons, calls a tool, reads the result, repeats." },
  { node: "report", title: "Report", blurb: "Writes the briefing for the recruiter." },
] as const;

export type StageNode = (typeof STAGES)[number]["node"];

export const TOOLS = [
  { name: "search_professional_profiles", label: "Search profiles", blurb: "Looks for public professional profiles." },
  { name: "fetch_public_profile", label: "Read a profile", blurb: "Reads a public profile for evidence." },
  { name: "record_candidate", label: "Save candidate", blurb: "Keeps a real candidate, with the source." },
  { name: "score_candidate", label: "Score candidate", blurb: "Rates the evidence against the job." },
] as const;

export const toolLabel = (name: string) => TOOLS.find((t) => t.name === name)?.label ?? name;

export function clock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
