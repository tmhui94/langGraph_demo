# Saved agents: re-think when the role changes

## Context
When you re-run a saved agent with a new **job title**, the output still follows the old role. The cause is in `withNewInputs` (`frontend/src/savedAgents.ts:69`): it overwrites only `job_title`, `location`, `candidates_wanted` and `mandatory` in the saved requirements. The derived fields stay as they were saved: `technical_skills`, `alternative_titles`, `preferred`, `industries` and `knockout_criteria`. The saved plan is patched only by an exact find-and-replace, so a step like "search `language:csharp`" never changes. With `reused=true`, `understand_node` and `plan_node` skip the AI, and the agent loop gets a new title next to old skills and old search steps. In practice it follows the steps.

**Goal:** when the role changes, the run reflects the new role. When only the location or count changes, the run still reuses the saved steps with no AI call, so the demo's "reuse" point stays.

## Approaches (you picked 1)
1. **Re-think on role change (picked).** If the job title or must-haves differ from the saved values, Understand and Plan run again with the AI, seeded with the saved requirements and plan and asked to adapt them. Otherwise the saved steps are reused as today. It costs two AI calls, only when the role changed, and the audience sees the agent adjust its plan.
2. Tell the agent only. A note in the first agent message says the new title overrides the saved skills and steps. It costs nothing, but it is unreliable and the old steps still show.
3. Always re-think. This is reliable, but saved agents would then skip nothing.

## Design
**Trigger (frontend).** In `PromptView.runAgent`, compute `roleChanged`. It is true when the trimmed, case-insensitive `job_title` differs from the saved value, or when the set of `mandatory` items differs. Send `adapt: roleChanged` with the existing `saved_requirements` and `saved_plan`. For an adapted run, send the saved agent's original `prompt` as `job_description`, so the AI has the original brief for context.

**API / schema.**
- `backend/app/schemas.py`: add `CampaignCreate.adapt: bool = False` and `Campaign.adapted: bool = False`.
- Mirror both fields in `frontend/src/api.ts`, and add `"adapted"` to the `AgentEvent` type union.

**Create / start (`backend/app/main.py`).**
- When saved data is present and `adapt` is true, store the seed requirements and plan on the campaign as today, but set `adapted = True` and leave `reused = False`.
- In `start_campaign`, keep the plan if `reused or adapted`.
- Pass `adapted` into the initial graph state.

**Graph (`backend/app/graph/workflow.py`).**
- Add `adapted: bool` to `GraphState`.
- **`understand_node`, when `adapted`:**
  - Publish `{"type": "adapted", "node": "understand", "detail": ADAPTED_NOTE}`.
  - Call `stream_claude` with `UNDERSTAND_SYSTEM` and the same `REQUIREMENTS_SCHEMA`. The user content holds the `original_brief`, the `saved_requirements` and the `new_inputs` (title, location, count, must-haves), with an instruction: "The recruiter changed the inputs. Rewrite the requirements for the new role. Drop skills and titles that only fit the old role."
  - After parsing, force the user's values for `job_title`, `location`, `candidates_wanted` and `mandatory`. The inputs the user typed always win.
  - Then call `apply_variables`.
- **`plan_node`, when `adapted`:**
  - Publish the `adapted` event.
  - Run the normal plan call, adding `previous_plan` (the seed plan) and the instruction "Adapt this plan to the new requirements. Keep its structure where it still fits."
  - Save to `campaign.plan` as the normal path does.
- The reused path and the fresh path stay as they are.

**UI.**
- `useAgentRun.ts`: on an `adapted` event, set `section.adapted = e.detail`, alongside the existing `reused` handling.
- `ThoughtStream.tsx`:
  - For an adapted section, prefix the summary with "Adapted from the saved agent."
  - Show a banner: title "Adapting to the new role", text "{detail} The job title or must-haves changed, so the AI re-thinks this step." Use the same styling as the reused banner, in a different accent colour.
- `LiveView.tsx`: after the location, show "(saved agent, adapted)" when `campaign.adapted`.
- `PromptView.AgentPanel`: when the title or must-haves have been edited, show a small hint above Run: "Role changed: the agent will re-think its requirements and plan." This tells the presenter in advance that the run will make AI calls.

**Docs.** Update the "Saved agents" bullet in `CLAUDE.md` and the related README paragraph (README.md about lines 75-76) to describe the adapted path.

## Non-goals
- No change to location-only or count-only re-runs. They are still reused with no AI call. The plan's find-and-replace stays.
- No backend storage for saved agents.

## Left to the builder
- The wording of `ADAPTED_NOTE` and the prompt instructions.
- Whether the GraphSpine badge shows "adapted". Optional, and only if it fits.

## Files
`frontend/src/views/PromptView.tsx`, `frontend/src/api.ts`, `frontend/src/useAgentRun.ts`, `frontend/src/components/ThoughtStream.tsx`, `frontend/src/views/LiveView.tsx`, `backend/app/schemas.py`, `backend/app/main.py`, `backend/app/graph/workflow.py`, `CLAUDE.md`, `README.md`. Save this design as `docs/superpowers/specs/2026-11-25-saved-agent-adapt-design.md` and commit it.

## Verification
1. `cd frontend; npm run build` (type check).
2. `cd backend; python -c "from app.graph.workflow import workflow; print(workflow.get_graph().draw_mermaid())"` (the graph compiles).
3. Run with `docker compose up --build`, then:
   - Open a saved agent (from the C#/.NET demo), change **only the location**, and run. Understand and Plan should show "No AI call needed".
   - Change the **job title** (for example, to "Data Analyst") and run. Understand and Plan should show "Adapting to the new role" and stream their reasoning. The extracted skills and plan should no longer mention C# or .NET, and the agent's searches and shortlist should target the new role.
   - Change only the must-haves. This should also take the adapted path.
