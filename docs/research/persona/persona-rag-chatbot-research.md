# Research: Real-Human Persona Chatbots with RAG

**Date:** 2026-07-02
**Context:** Research conducted while building the Isaac Schultz legislator chat MVP (see `legislator_chat.py`), to inform how to balance "sounds like a real human" against hallucination/misattribution risk when simulating a real, named, living person. Produced via a multi-agent deep-research workflow (104 agents, 22 sources fetched, 85 claims extracted, 25 adversarially verified).

## Summary

Real-human persona chatbots grounded via RAG (or in-context "corpus stuffing") face a well-documented failure mode called **character/persona hallucination** — models deviating from or fabricating beyond what the source record supports, distinct from ordinary factual hallucination and persisting even in frontier models. Academic work converges on three defenses relevant to this project:

1. **Structured, queryable identity grounding** (knowledge graphs of beliefs/traits/values, not just raw context stuffing) to prevent identity drift over long conversations.
2. **Explicit role/persona separation** — designers should scope which social traits (concise, on-topic) are safe to project versus which (genuine empathy, lived experience) cannot be legitimately simulated regardless of how convincing the output sounds.
3. **Treating citation as a structural/architectural problem, not a prompting problem** — models are good at citing the right document but unreliable at citing the right span within it, and prompting-only citation is fundamentally weaker than constrained decoding or post-hoc verification.

A real-world deployed Voting Advice Application (VAA) chatbot study around Germany's 2024 EU election is the closest direct empirical analog to this project: users preferred a conversational interface to a rigid questionnaire specifically for simplified language and flexible interaction, but explicitly demanded more transparency — researchers responded with traceable/explainable outputs, RAG citation of primary sources, and expandable info boxes. This directly validates a citation-chip-style UI.

**Coverage gap:** No GitHub open-source implementations or X/Twitter practitioner discussion survived adversarial verification in this evidence set, so this report is grounded entirely in peer-reviewed/arXiv literature. That gap should be treated as unanswered, not as evidence such patterns don't exist.

---

## Confirmed Findings

### 1. Persona/role-play hallucination is a distinct, named failure class that persists even in frontier models

**Confidence:** High (3-0 / 2-1 votes)

RoleBreak formally defines "character hallucination" as when a model deviates from its assigned persona, explicitly distinguishing it from typical LLM hallucination caused by insufficient knowledge, and frames severe deviations as a jailbreak-adjacent vulnerability triggered by adversarial or edge-case queries. TimeChara built a 10,895-instance automated benchmark specifically for "point-in-time character hallucination" and found even GPT-4o showed significant hallucination on it (≤51% accuracy on future-knowledge-leakage queries).

*Caveat: TimeChara tests fictional literary characters (Harry Potter, LOTR, etc.), not real living people — analogically relevant rather than a direct study of real-person simulation. But it establishes that grounding failures are a persistent, measurable phenomenon that survives into the best available models, directly explaining the fabrication behavior observed in this project (the invented "personal commitments" excuse for a vote absence).*

- [RoleBreak: Character Hallucination as a Jailbreak Attack in Role-Playing Systems](https://arxiv.org/html/2409.16727v1) (arXiv 2409.16727, ACL COLING 2025)
- [TimeChara: Evaluating Point-in-Time Character Hallucination of Role-Playing Large Language Models](https://arxiv.org/pdf/2405.18027) (arXiv 2405.18027, ACL Findings 2024)

### 2. The core risk is a "role" vs. "persona" mismatch — directly explains the fabrication bug hit in this project

**Confidence:** High (2-1 votes)

LLMs simulating roles/personas can create a mismatch between what the designer intends the bot to represent and what users perceive/infer, producing risks of emotional manipulation, epistemic injustice, and unwarranted trust — precisely the risk profile of a bot impersonating a real, named, living legislator. The paper distinguishes **role** (expected behaviors within the socio-technical context, e.g. answering questions about voting record) from **persona** (social/personality face — being curious, polite, empathetic) as two separable attributions a designer assigns.

*Practical implication: a bot can legitimately be assigned a "role" (answer questions grounded in voting record) without licensing a full "persona" (implying the bot has genuine opinions, feelings, or biographical experiences). The fabrication failure (invented personal excuses) looks like an unintended persona-level attribution leaking in where only a role-level attribution was intended — the fix already applied (explicitly banning invented personal facts/biography in the system prompt) directly targets this.*

- [Social Attributions of Large Language Models: An HCXAI-based Approach](https://arxiv.org/pdf/2403.17873) (arXiv 2403.17873, HCXAI24 workshop)

### 3. Structured, queryable identity grounding beats implicit persona cues in a growing context for long conversations

**Confidence:** Medium (3-0 / 2-1 votes)

ID-RAG proposes grounding an agent's persona in a dynamic, structured identity knowledge graph of beliefs, traits, and values, queried at decision-time, rather than baking persona into an ever-growing conversational memory buffer that dilutes identity coherence over long horizons. The same research group's broader "Human-AI Agents" architecture is explicitly framed as intended to align an agent's persona with real-world individuals using "Chronicles" — knowledge graphs derived from a real entity's own data — directly the digital-twin-of-a-real-person use case this project represents.

*Caveat: the paper's own validation used static, handcrafted Chronicles rather than a real person's actual digital footprint — an architectural proposal and framing, not a proven-in-production system for real people. Practical translation: even without moving to vector RAG, structuring the legislator's record as an explicit, queryable schema (positions/bills/votes with typed relationships — which this project already does via `sponsorship`/`vote_record`/`ai_enrichment` tables) rather than unstructured prose-stuffing may reduce identity drift as conversations get longer.*

- [ID-RAG: Identity Retrieval-Augmented Generation for Long-Horizon Persona Coherence in Generative Agents](https://www.researchgate.net/publication/396048635_ID-RAG_Identity_Retrieval-Augmented_Generation_for_Long-Horizon_Persona_Coherence_in_Generative_Agents) (mirrors [arxiv.org/abs/2509.25299](https://arxiv.org/abs/2509.25299))

### 4. A real deployed political chatbot validates the citation-chip UI approach

**Confidence:** High (3-0 / 2-1 / 3-0 votes)

The closest real-world empirical analog to this project: a Voting Advice Application chatbot deployed to 331 users before Germany's 2024 EU Parliament election, using a mixed-methods field deployment (surveys, conversation logs, 10 follow-up interviews). Users described the traditional questionnaire format as "a wall of text" they only skimmed, versus the chatbot's "friendly" and appropriately-lengthed answers with on-demand clarification; it scored in the 90th-95th percentile on a usability benchmark with very low frustration. Critically, users simultaneously voiced a strong desire for transparency (citing concerns like sycophancy and opacity), which the authors turned into named design recommendations: **traceable/explainable outputs, RAG-style citation of primary sources, and expandable info boxes** describing training data, developers, capabilities, and risks.

*This directly validates surfacing citations as a distinct, inspectable UI element (the citation-chip approach already built) rather than omitting or burying sourcing — transparency and "feeling human/flexible" were not in tension for users, they were both explicitly demanded.*

- [Learn, Explore and Reflect by Chatting: Understanding the Value of an LLM-Based Voting Advice Application Chatbot](https://arxiv.org/pdf/2505.09806) (arXiv 2505.09806)

### 5. Citation accuracy is a structural problem, not a prompting problem

**Confidence:** High (3-0 / 2-1 votes)

Models are much better at citing the correct source *document* than the precise supporting *span* within it — across three QA benchmarks, document-level citation accuracy (Doc-F1) was consistently high (43-94%) while span-level accuracy (Snippet-F1) was dramatically lower (5.6-75%). Prompt-only citation instructions are a weak grounding mechanism compared to structurally-enforced alternatives (constrained decoding, post-hoc span alignment/verification), because prompt compliance depends entirely on the model choosing to follow instructions correctly. Independent converging evidence found LLMs **post-rationalize citations in up to 57% of cases** — i.e., generate a plausible-sounding citation after already deciding the claim, not from the citation.

*This is a very plausible mechanism behind the "model fabricates a claim then attaches a loosely-related bill as citation" failure mode. Practical implication: since this project's system stuffs the full record into the prompt and lets the model self-report citations via a `SOURCES:` line, citation-prose alignment should be assumed unreliable at the sentence level even when it looks right at the bill/document level. Worth hardening: programmatically verify that a cited bill's summary/key_points actually semantically overlaps with the claim, rather than trusting the model's self-reported linkage outright.*

- [Explicit Evidence Grounding via Structured Inline Citation Generation](https://arxiv.org/html/2606.07130) (arXiv 2606.07130)

---

## Caveats

- **Coverage gap:** the original research brief asked for three pillars — (1) arXiv literature, (2) GitHub open-source implementations, (3) X/Twitter practitioner discussion. Only pillar (1) survived adversarial verification. This report should not be read as having surveyed or ruled out open-source implementation patterns or practitioner Twitter discourse — those remain open gaps, not negative findings.
- Several **refuted-but-plausible** claims are worth a human re-check rather than dismissal, since 3-vote verification of nuanced ethical/definitional claims is failure-prone in ways that don't necessarily mean the source is wrong or irrelevant:
  - RoleBreak's proposed root-cause mechanisms (query sparsity, role-query conflict) and its finding that rejection-based defenses reduce hallucination but degrade conversational quality — a direct precedent for the "loosening from exact-match to thematic-connection" tradeoff already navigated in this project.
  - Consent models for digital clones of real people ([arXiv 2504.18807](https://arxiv.org/pdf/2504.18807) — "Clones in the Machine: A Feminist Critique of Agency in Digital Cloning") and privacy/oversight risks of assigning a real individual's persona to an LLM ([arXiv 2404.18231](https://arxiv.org/pdf/2404.18231) — "From Persona to Personalization: A Survey on Role-Playing Language Agents"). Both touch directly on the ethical territory most relevant to this project (simulating a real, named, living politician) and tie back to the unresolved "legislator office authorization" question from the original MVP plan — **recommend reading these two directly before any decision on real-user exposure.**
- **Time-sensitivity:** the strongest empirical field-deployment evidence (the VAA chatbot study) is from a single prototype tested around one 2024 election with a young, left-skewing sample (median age 30) — treat its UX conclusions as suggestive, not universally generalizable. The ID-RAG/Chronicle architecture for real-person grounding is a 2025 workshop paper whose real-person use case is aspirational/framed rather than empirically validated.

## Open Questions (not answered by this research pass)

1. What do actual open-source "chat with a real person" or persona-RAG GitHub repos do architecturally (context-stuffing vs. vector retrieval, memory handling, citation UI)?
2. What are AI engineers and founders actually saying on X/Twitter about what breaks in production persona bots and what UX patterns make them feel human while staying trustworthy?
3. What legal/reputational precedents or cautionary case studies exist specifically for AI simulations of real, named, living politicians (as opposed to fictional characters or anonymized/consenting individuals) — e.g., defamation risk from misattributed views, right-of-publicity issues, documented public backlash?
4. Is there empirical work (rather than architectural proposals) evaluating whether "thematically connect the question to a related bill" grounding strategies measurably increase misattribution/hallucination rates compared to strict exact-match grounding — which would directly quantify the tradeoff already made in this project?

---

## All Sources

| URL | Quality | Angle |
|---|---|---|
| [RoleBreak (arXiv 2409.16727)](https://arxiv.org/html/2409.16727v1) | Primary | Persona grounding & faithfulness |
| [TimeChara (arXiv 2405.18027)](https://arxiv.org/pdf/2405.18027) | Primary | Persona grounding & faithfulness |
| [From Persona to Personalization survey (arXiv 2404.18231)](https://arxiv.org/pdf/2404.18231) | Primary | Persona grounding & faithfulness |
| [Role-Play Paradox in LLMs (arXiv 2409.13979)](https://arxiv.org/html/2409.13979v2) | Primary | Digital twin & role-play of real people |
| [Clones in the Machine: A Feminist Critique of Agency in Digital Cloning (arXiv 2504.18807)](https://arxiv.org/pdf/2504.18807) | Primary | Digital twin & role-play of real people |
| [Social Attributions of LLMs: HCXAI (arXiv 2403.17873)](https://arxiv.org/pdf/2403.17873) | Primary | Digital twin & role-play of real people |
| [PersonaCite (arXiv 2601.22288)](https://arxiv.org/html/2601.22288) | Primary | Digital twin & role-play of real people |
| [ID-RAG (ResearchGate / arXiv 2509.25299)](https://www.researchgate.net/publication/396048635_ID-RAG_Identity_Retrieval-Augmented_Generation_for_Long-Horizon_Persona_Coherence_in_Generative_Agents) | Primary | Digital twin & role-play of real people |
| [VAA Chatbot study (arXiv 2505.09806)](https://arxiv.org/pdf/2505.09806) | Primary | Digital twin & role-play of real people |
| [cv-santiago (GitHub)](https://github.com/santifer/cv-santiago) | Secondary | Open-source architecture patterns |
| [persona-kit (GitHub)](https://github.com/albertnahas/persona-kit) | Secondary | Open-source architecture patterns |
| [RAG vs. prompt stuffing (Weights & Biases)](https://wandb.ai/byyoung3/rag-eval/reports/RAG-vs-prompt-stuffing-Do-we-still-need-vector-retrieval---VmlldzoxMzE5Mjk0NA) | Blog | Open-source architecture patterns |
| [Explicit Evidence Grounding via Structured Inline Citation Generation (arXiv 2606.07130)](https://arxiv.org/html/2606.07130) | Primary | Citation & grounding UI patterns |
| [Citation-Aware RAG (Tensorlake blog)](https://www.tensorlake.ai/blog/rag-citations) | Blog | Citation & grounding UI patterns |
| [Building Trustworthy RAG Systems with In-Text Citations](https://haruiz.github.io/blog/improve-rag-systems-reliability-with-citations) | Blog | Citation & grounding UI patterns |
| [Cited but Not Verified (arXiv 2605.06635)](https://arxiv.org/pdf/2605.06635) | Primary | Citation & grounding UI patterns |
| [AI 'deadbots' are persuasive (NPR)](https://www.npr.org/2025/08/26/nx-s1-5508355/ai-dead-people-chatbots-videos-parkland-court) | Unreliable (no claims survived) | Practitioner war stories / failure modes |
| [AI griefbots create a computerized afterlife (The Week)](https://theweek.com/tech/artificial-intelligence-griefbots-afterlife-controversy) | Secondary | Practitioner war stories / failure modes |
| [AI Digital Twins Raise High-Stakes Identity Risks (TechNewsWorld)](https://www.technewsworld.com/story/digital-twins-and-the-risks-of-ai-immortality-180273.html) | Unreliable (no claims survived) | Practitioner war stories / failure modes |
| [AI chatbots can sway voters better than political advertisements (MIT Technology Review)](https://www.technologyreview.com/2025/12/04/1128824/ai-chatbots-can-sway-voters-better-than-political-advertisements/) | Secondary | Practitioner war stories / failure modes |

*Two additional sources were fetched but yielded no verifiable claims: a medRxiv clinical RAG chatbot retrospective and a "Why Citation-Based RAG Still Hallucinates" practitioner note — both directionally relevant but too thin on verifiable specifics to include as findings.*

---

## Addendum (2026-07-16): Hybrid retrieval (RRF) for legislator-record grounding

Evaluates whether [Supabase's hybrid search](https://supabase.com/docs/guides/ai/hybrid-search) (full-text + vector search fused via Reciprocal Rank Fusion) should inform legislator-chat retrieval.

### RRF in brief
Runs keyword search (`tsvector` + GIN) and vector search (`pgvector`) independently, then ranks items that score well in *both* via `score = Σ 1/(k + rank)` (k≈50). Requires a `tsvector` column/index alongside the existing embedding column, plus a fused-ranking SQL function.

### Relevance: not new, a formalization of existing practice
`ask.py`'s `_resolve_bill()` already does hybrid retrieval by hand: exact number → fuzzy title → semantic candidates → LLM pick. RRF would replace that cascade with one scored pass. For legislator chat, this matters because a real implementation must retrieve relevant bills from a legislator's corpus (not dump all into the prompt like the current demo does); vector search alone misses lexical matches (bill numbers) that keyword search handles.

**Caveats:**
- Current index is IVFFlat, not HNSW — index choice is separate from RRF fusion design; don't bundle them.
- Single legislator's corpus is tens to low-hundreds of bills — small enough to try vector retrieval first, measure for missed lexical matches, then adopt RRF only if justified.

### Key sources

**Direct analogs (persona/voting from real record):**
- [Persona-driven Simulation of Voting Behavior in the European Parliament with LLMs](https://arxiv.org/abs/2506.11798) (2025) — closest precedent; simulating legislator stance from record
- [Political Actor Agent: Simulating Legislative System for Roll Call Votes Prediction](https://arxiv.org/pdf/2412.07144) (Dec 2024) — voting prediction grounded in legislative record
- [Can Commercial LLMs Be Parliamentary Political Companions?](https://arxiv.org/pdf/2603.30028) — LLM vs. real legislative documents (fidelity benchmark)

**Grounding & hallucination (foundational):**
- [Retrieval Augmentation Reduces Hallucination in Conversation](https://arxiv.org/abs/2104.07567) (Shuster et al., 2021) — the empirical basis for retrieve-first architecture
- [RefusalBench](https://arxiv.org/html/2510.10390) — validates cite-or-refuse guardrails via selective refusal benchmarking

**Real-world risk calibration:**
- 2024 US primary chatbot clones: [Washington Post](https://www.washingtonpost.com/technology/2024/01/22/ai-deepfake-elections-politicians/), [Harvard Ash Center](https://ash.harvard.edu/articles/the-apocalypse-that-wasnt-ai-was-everywhere-in-2024s-elections-but-deepfakes-and-misinformation-were-only-part-of-the-picture/) — documented trust/accuracy failures

### Bottom line
No change to core recommendations (structured record grounding, cite-or-refuse as structural not prompt-level, role/persona separation). Adds: (1) one retrieval-architecture option (RRF) with explicit caveat to measure before building, (2) three directly-on-genre papers worth citing in design docs.
