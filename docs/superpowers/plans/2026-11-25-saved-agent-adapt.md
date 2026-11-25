# Saved Agent Adapt-on-Role-Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a saved agent is re-run with a changed job title or must-haves, re-run Understand and Plan with the AI, seeded from the saved requirements and plan. Location-only and count-only re-runs stay fully reused, with no AI call.

**Architecture:**
- The frontend decides `adapt` by comparing the edited inputs with the saved variables, and sends it with `saved_requirements` and `saved_plan`.
- The backend marks the campaign `adapted`. `understand_node` and `plan_node` then take a third path: publish an `adapted` event, call Claude with the seed plus an "adapt this" instruction, and force the user's typed values.
- The UI renders the `adapted` event like `reused`, with different copy.

**Tech Stack:** FastAPI, LangGraph, Pydantic, React, TypeScript, MUI.

**Spec:** `docs/superpowers/specs/2026-11-25-saved-agent-adapt-design.md`

## Global Constraints
- The repo has no test suite. Automated checks are `npm run build` (in `frontend/`), the graph compile command, and the throwaway check script in Task 1 (kept in the scratchpad and not committed).
- `backend/app/schemas.py` is mirrored by hand in `frontend/src/api.ts`. Update both.
- The user's typed `job_title`, `location`, `candidates_wanted` and `mandatory` always win over the AI's output.
- The reused path and the fresh path must behave exactly as they do today.
- Every LLM call goes through `stream_claude`, and its `stop_reason` must be checked, as the existing nodes do.

## Review Focus
1. **Cosmetic title edits:** a change to case or surrounding whitespace only (" software engineer " vs "Software Engineer") is not a role change. The run should stay reused. Covered in Task 2.
2. **Re-ordered must-haves:** must-haves with a different order or extra spaces are the same set and should stay reused. Covered in Task 2.
3. **Empty job title from the AI:** if Claude returns an empty `job_title` on the adapted path, the user's title must still be used. Covered in Task 1, check 1.
4. **Count of 0 or blank:** `withNewInputs` already clamps the count to ≥1, so the forced `candidates_wanted` is never 0. Covered in Task 1, check 1.
5. **Plan preserved across start:** `start_campaign` must not clear the seed plan for an adapted campaign before `plan_node` reads it. Covered in Task 1, check 2.

---

### Task 1: Backend adapted path

**Files:**
- Modify: `backend/app/schemas.py` (`CampaignCreate` ~L26-36, `Campaign` ~L96-114)
- Modify: `backend/app/main.py` (`create_campaign` L58-61, `run_campaign` initial state L81-92, `start_campaign` L125)
- Modify: `backend/app/graph/workflow.py` (`GraphState`, `understand_node`, `plan_node`, plus a new `ADAPTED_NOTE` constant next to `REUSED_NOTE`)
- Check script (not committed): `<scratchpad>/check_adapt.py`

**Interfaces:**
- Produces:
  - `CampaignCreate.adapt: bool = False` and `Campaign.adapted: bool = False`.
  - Graph state key `adapted: bool`.
  - SSE event `{"type": "adapted", "node": "understand" | "plan", "detail": ADAPTED_NOTE}`.

- [ ] **Step 1: Schema and API.**
  - Add the two fields.
  - In `create_campaign`, when saved data is present, set `campaign.adapted = payload.adapt` and `campaign.reused = not payload.adapt`.
  - In `start_campaign`, change the guard to `if not (campaign.reused or campaign.adapted):`.
  - Add `"adapted": campaign.adapted` to the initial state.

- [ ] **Step 2: `understand_node` adapted branch.** It goes after the `reused` branch and before the fresh call.
  - Publish the `adapted` event.
  - Take `seed = store.get(UUID(cid)).requirements`.
  - Call `stream_claude(cid, "understand", system=UNDERSTAND_SYSTEM, output_schema=REQUIREMENTS_SCHEMA, max_tokens=16000)`. The single user message is JSON with:
    - `instruction`: "The recruiter changed the inputs of a saved search. Rewrite the requirements for the new inputs. Drop skills, titles and industries that only fit the old role; keep what still applies."
    - `original_brief`: `state["job_description"]`
    - `saved_requirements`: `seed.model_dump(exclude={"search_queries"})`
    - `new_inputs`: `{job_title, location, candidates_wanted, mandatory}` taken from `seed`. The frontend already wrote the new values into it.
  - Check `stop_reason` exactly as the fresh path does.
  - After `json_of`, overwrite `job_title`, `location`, `candidates_wanted` and `mandatory` with the values from `seed`.
  - Return `apply_variables(state, JobRequirements(**data))`.

- [ ] **Step 3: `plan_node` adapted branch.**
  - Publish the `adapted` event.
  - Run the same call as the fresh path, adding two keys to the user JSON:
    - `previous_plan`: `store.get(UUID(cid)).plan`
    - `instruction`: "Adapt the previous plan to these requirements. Keep its structure where it still fits; change searches and steps that targeted the old role."
  - Then use the shared tail (publish `plan`, save `campaign.plan`, `first_agent_turn`). Factor that tail into a local helper if it would otherwise be duplicated.

- [ ] **Step 4: Compile the graph.**
  Run: `cd backend; python -c "from app.graph.workflow import workflow; print(workflow.get_graph().draw_mermaid())"`
  Expected: the Mermaid text prints, with no exception.

- [ ] **Step 5: Throwaway check script.** `check_adapt.py` runs with `cwd=backend`. It monkeypatches `app.graph.workflow.stream_claude` with an async fake that:
  - records its `messages`;
  - returns an object with `stop_reason="end_turn"`;
  - returns JSON through a patched `json_of`. For understand, the fake requirements have `job_title=""`, `mandatory=["X"]` and `technical_skills=["SQL"]`. For plan, they are `{"steps":[{"step":1,"tool":"none","purpose":"p"}]}`.

  It creates a campaign through `app.main.create_campaign(CampaignCreate(job_title="Data Analyst", location="Penang", job_description="old brief", minimum_candidates=3, saved_requirements=JobRequirements(job_title="Data Analyst", location="Penang", candidates_wanted=3, mandatory=["SQL"], technical_skills=["C#"]), saved_plan=[{"step":1,"tool":"none","purpose":"old"}], adapt=True))`. Then it calls `start_campaign` with `run_campaign` patched to a no-op. It asserts:
  1. `campaign.adapted is True` and `campaign.reused is False`. After `understand_node`, `campaign.requirements.job_title == "Data Analyst"`, `mandatory == ["SQL"]`, `candidates_wanted == 3` and `technical_skills == ["SQL"]`.
  2. After `start_campaign`, `campaign.plan == [{"step":1,"tool":"none","purpose":"old"}]`. The plan prompt the fake receives contains `"previous_plan"`. After `plan_node`, `campaign.plan[0]["purpose"] == "p"`.
  3. A second campaign with `adapt=False` has `reused is True`, and its `understand_node` never calls the fake.

  Run: `cd backend; python <scratchpad>/check_adapt.py`
  Expected: it prints `OK`.

- [ ] **Step 6: Commit** `backend/app/schemas.py`, `backend/app/main.py` and `backend/app/graph/workflow.py` with the message `feat: adapt saved agent requirements and plan when the role changes`.

### Task 2: Frontend trigger and display

**Files:**
- Modify: `frontend/src/api.ts` (`Campaign`: add `adapted?: boolean`; `AgentEvent.type`: add `"adapted"`)
- Modify: `frontend/src/savedAgents.ts` (add `roleChanged`)
- Modify: `frontend/src/views/PromptView.tsx` (`AgentPanel` hint, `runAgent` body)
- Modify: `frontend/src/useAgentRun.ts` (`Section.adapted?: string`, reducer case)
- Modify: `frontend/src/components/ThoughtStream.tsx` (`summaryOf`, `StepBody` banner)
- Modify: `frontend/src/views/LiveView.tsx` (location suffix, L39)

**Interfaces:**
- Consumes: from Task 1, the `adapt` request field, the `adapted` campaign field and the `adapted` event.
- Produces: `export function roleChanged(agent: SavedAgent, values: Record<VariableKey, string>): boolean` in `savedAgents.ts`.

- [ ] **Step 1: `roleChanged`.** It returns true if either of these holds:
  - The normalized titles differ, where normalizing means `trim().toLowerCase()`.
  - The must-have sets differ. Split each on `,`, trim, lowercase, drop empty items, then compare as sets.

  Location and count are ignored.

- [ ] **Step 2: `runAgent`.** Let `adapt = roleChanged(agent, values)`. Add `adapt` to the body. When `adapt` is true, set `job_description` to `agent.prompt`. Otherwise keep the existing "Re-run of…" string.

- [ ] **Step 3: `AgentPanel` hint.** When `roleChanged(agent, values)` is true, render `<Typography variant="body2" color="warning.main">Role changed: the agent will re-think its requirements and plan.</Typography>` above the Run button.

- [ ] **Step 4: Display.**
  - **Reducer:** add `case "adapted": section.adapted = e.detail; break;`.
  - **`summaryOf`:** if `s.adapted` is set, prefix the summary with `"Adapted from the saved agent. "`.
  - **`StepBody`:** when `section.adapted` is set, show a banner styled like the reused one, but with `var(--medium)` as the border colour.
    - If `--medium` isn't defined in `styles.css`, use `warning.main` instead.
    - Banner title: `Adapting to the new role`
    - Banner body: `{section.adapted} The job title or must-haves changed, so the AI re-thinks this step.`
  - **`LiveView`:** the location suffix becomes `campaign.reused ? " (saved agent)" : campaign.adapted ? " (saved agent, adapted)" : ""`.

- [ ] **Step 5: Type check.**
  Run: `cd frontend; npm run build`
  Expected: `tsc -b` and `vite build` finish with no errors.

- [ ] **Step 6: Commit** the six frontend files with the message `feat: show and trigger adapted saved-agent runs`.

### Task 3: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` ("Saved agents" bullet under the LangGraph section)
- Modify: `README.md` (the paragraph at about L74-76)

- [ ] **Step 1: Update both docs.** Add one sentence to each: if the job title or must-haves changed, the frontend sends `adapt: true`, the campaign is `adapted` (not `reused`), and Understand and Plan re-run with the AI, seeded with the saved requirements and plan, while the user's inputs are kept as typed.

- [ ] **Step 2: End-to-end run.** Use `docker compose up --build`, with `ANTHROPIC_API_KEY` set, and a saved agent from the C#/.NET demo.
  - **Location only changed:** Understand and Plan show "No AI call needed".
  - **Job title changed to "Data Analyst":** both show "Adapting to the new role" and stream reasoning. The Understand summary's skills and the plan steps no longer mention C# or .NET.
  - **Must-haves changed only:** the run takes the adapted path.

  If no API key is available, report that this step was skipped.

- [ ] **Step 3: Commit** with the message `docs: describe adapted saved-agent runs`.
