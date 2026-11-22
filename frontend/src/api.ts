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
  created_at: string;
}
