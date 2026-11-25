from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class SourceReference(BaseModel):
    url: str
    title: str = ""
    retrieved_at: datetime = Field(default_factory=datetime.utcnow)
    kind: str = "search_result"
    excerpt: str = ""


class ScoringWeights(BaseModel):
    relevant_experience: float = 25
    technical_skills: float = 25
    industry_experience: float = 20
    education: float = 10
    projects_achievements: float = 15
    certifications: float = 5


class CampaignCreate(BaseModel):
    job_title: str = ""
    job_description: str
    location: str = ""
    mandatory_qualifications: list[str] = Field(default_factory=list)
    preferred_qualifications: list[str] = Field(default_factory=list)
    minimum_candidates: int = 20
    scoring_weights: ScoringWeights = Field(default_factory=ScoringWeights)
    # Re-running a saved agent: reuse its requirements and plan instead of asking the AI again.
    saved_requirements: "JobRequirements | None" = None
    saved_plan: list[dict[str, Any]] | None = None
    # The job title or must-haves changed: re-run Understand and Plan, seeded with the saved ones.
    adapt: bool = False


class JobRequirements(BaseModel):
    job_title: str
    location: str = ""
    candidates_wanted: int = 0
    mandatory: list[str] = Field(default_factory=list)
    preferred: list[str] = Field(default_factory=list)
    technical_skills: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    alternative_titles: list[str] = Field(default_factory=list)
    knockout_criteria: list[str] = Field(default_factory=list)
    search_queries: list[str] = Field(default_factory=list)


class Candidate(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    current_title: str = "Not Found"
    current_company: str = "Not Found"
    location: str = "Not Found"
    professional_email: str | None = None
    professional_phone: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    resume_available: bool = False
    resume_url: str | None = None
    summary: str = ""
    employment_history: list[dict[str, Any]] = Field(default_factory=list)
    education: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    sources: list[SourceReference] = Field(default_factory=list)
    relevant_experience_years: float | None = None
    evidence_status: str = "live"


class CriterionScore(BaseModel):
    name: str
    score: float
    weight: float
    weighted_score: float
    evidence: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)


class CandidateEvaluation(BaseModel):
    candidate_id: UUID
    criterion_scores: list[CriterionScore] = Field(default_factory=list)
    total_score: float = 0
    category: str = "LOW"
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    knockout_findings: list[str] = Field(default_factory=list)
    recruiter_review_required: bool = True


class Campaign(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    job_title: str
    job_description: str
    location: str
    mandatory_qualifications: list[str] = Field(default_factory=list)
    preferred_qualifications: list[str] = Field(default_factory=list)
    minimum_candidates: int = 20
    scoring_weights: ScoringWeights = Field(default_factory=ScoringWeights)
    status: str = "DRAFT"
    requirements: JobRequirements | None = None
    candidates: list[Candidate] = Field(default_factory=list)
    evaluations: list[CandidateEvaluation] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    plan: list[dict[str, Any]] = Field(default_factory=list)
    summary: str = ""
    limitation: str = ""
    reused: bool = False
    adapted: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


CampaignCreate.model_rebuild()
