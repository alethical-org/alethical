https://alethical.com/

Roadmap
how does it impact me personally (user)
Enables deep-dive analysis of omnibus bills to surface hidden provisions



Legislative Angel App Overview
Real-time Minnesota bill tracking application
Shows all bills with current status (introduced, in committee, passed, etc.)
AI summarizes each bill: stakeholders (policy makers), implementation details, likely impacts
	
Stakeholder basics so far:


Policymakers: authors and co-authors in House (HF) and Senate (SF)
Party context: whether a bill is driven by Republicans or Democrats or Bi-partisan (Whether the bill counts as bipartisan legislation)
DFL = Democratic-Farmer-Labor Party — Minnesota's Democratic Party.

Additional stakeholder signal Joseph suggested:


Whether votes were on strict party lines or not
How many from each party supported/opposed
More user-friendly than existing legislative tracking tools

Combine Find Your Legislator with the legislator search feature.
Legislator search lets users look up any legislator by name, district, or party, see how many bills they’ve passed, when they were introduced, and their contact info.
Together: user finds their own legislator by address, then can immediately see that person’s legislative record and contact details.

https://gis.lcc.mn.gov/iMaps/districts/

Feature


In-app Ask AI panel separate from Base44’s system chat
Chatbot interface over the internal bills database, not just a generic AI chat
Intended user use cases


Ask what laws exist about a given topic
Ask what was most recently passed on an issue
Ask what bills a specific legislator has passed or their voting record (e.g., if they’re running for higher office)
Needs / design implications


Clear placement (likely a side chatbot always available from the UI)
Reliable connection to the structured bills (status) + legislator data ( sponsors - who introduced/support the bill, votes - Click the vote count link (e.g., "128-4") in the Actions section → shows full roll call with each legislator's vote)
Good entity resolution for people (map “AOC” → the right legislator, etc.) so queries about individuals work well


Transparency and Accountability Features
Political promise vs. voting record analysis
Flag mismatches between campaign positions and actual votes
Extract basic stances from candidate websites, compare to voting patterns
Generate scoring system for promise-keeping vs. actual legislative behavior
Behind-the-scenes influence tracking - v2
Surface possible associations and relationships (Reddit-style investigation)
Integrate financial support data from .gov sources by year
Highlight questionable alignments and potential conflicts of interest
https://www.quiverquant.com/congresstrading/

Technical Implementation Challenges
Complex data extraction from Minnesota legislative website
Multi-step process: navigate database → click section pages → extract PDFs/HTML → repeat
Five steps across three different file types per bill
Current manual PDF upload system needs automation
Joe working on web scraping solution using Base 44 platform
Eugene offered 30-minute consultation with Rohan to solve scraping challenges
Similar solution already built during hackathon for immigration criteria


Data Quality and Credibility Concerns
Risk of conspiracy theory amplification from partial data
People cherry-pick information, post out of context, lose credibility online
Need pre-written analytical questions generating full, balanced assessments
Must be built on solid, credible data rather than generic LLM outputs
Example: Grok initially dismissed QAnon statistically until manually fed specific data
Generic LLMs (ChatGPT, Gemini) often miss or distort politically sensitive topics
Legislative Angel requires curated, credible data foundation

Data quality / credibility


Concern about cherry‑picked or out‑of‑context info and whose credibility is used
Idea: send the same prompt to several LLMs and compare responses before showing users
Multi‑model approach


Different models have different data sources and biases (Grok/Twitter, Gemini/Google search, ChatGPT/Reddit-heavy)
Use semantic similarity search across model outputs to gauge consistency and “temperature” of responses
Prior work Joseph mentioned


Did a school project in healthcare: same patient data into multiple LLMs, then analyzed bias (race, age) via semantic similarity
Wants to apply a similar method here for political data inside the Bloom Stack AI platform

Notebook LM Integration Plan
Build Notebook LM-style chatbot within Legislative Angel
Natural language queries: “Why were certain bills passed?” “What bills exist on X topic?”
“Did my congressperson support this bill?”
Campaign promises vs. actual votes comparison functionality
Similar prompt-caching approach already used in Joe’s capital markets AI copilot
30 predetermined analytical prompts for common user questions
Scoring system for candidate performance metrics
Minnesota as Transparency Pilot
Perfect timing and location for “spotlight on fraud” initiative
Aligns with independent movement’s transparency platform
250th anniversary of Declaration of Independence context
Minnesota as inflection point for national political direction
Tool’s value: fast, accurate transparency spotlighting
Enable independent journalists to ask hard questions with solid data backing
Immediate visibility into legislative reality vs. public messaging



Feedback for the app
Legislators who saw the app were “really excited” and see it as a “lifesaver” compared to:
Manually saving each individual bill
Running each one through AI separately
All feedback so far has been “all positive feedback” and “super good.”
Strong perceived fit for:
Legislators
Lobbyists
Potentially government/legislative bodies paying for use
Good timing/visibility angle:
Can be showcased on the campaign trail and at tech conferences
Can be presented to Andrew Yang / Forward Party as part of the independent movement and transparency in legislation

What needs to be done (next steps / work items)
Data cleanup & accuracy


“Get the legislators all updated there so they’re all accurate.”
Ensure “the bills that are in there match the legislators.”
Make sure “the information has to be accurate.”
Ask Joe to do this “in a spreadsheet or wherever.”
Technical ownership


Find “the guy that will own building it end to end and expanding it and maintaining it.”
This person will:
Build the app from current concept to MVP
Expand and maintain it going forward
You want to:
Manage the transition
Sign off on the tech stack
Ensure it’s “scalable and properly done”
Product spec / job definition


Prepare a document defining:
“What we’re going to build”
The “job to be done”
The scope for taking the app from concept to MVP launch
Team (including her) will review and “sign off on it” and give input.
Budgeting


She would currently be “the person that’s funding any of the stuff that we need.”
She needs clarity on:
“What does that cost look like to get it off the ground?”
“Where does that get us?” (i.e., what milestone/MVP)
You asked her for:
A one‑time “0 to 1” budget number for the developer (e.g. “500 bucks, 2,000 bucks… 1,000 is fine” as examples)
You suggested:
Treat it as a single budget to MVP launch, not a monthly rate
Possibly phasing work if she can add a bit more budget
MVP functionality & launch


Objective: “bare minimum functional app on the App Store.”
Key required pieces:
Accurate legislator and bill data (from Joe’s work)
Profiles, “sign in,” and basic account system
Enough functionality to:
Show “users with accounts and stuff”
Demonstrate value to legislators and potential investors
App Store launch is critical so:
She can “go and try to raise money”
You can gather a user base and feedback
Monetization / business model (early thinking)


Potential revenue sources:
Government paying “for legislators to use the app”
Lobbyists paying to use the app
Pricing structure ideas:
“Free basic version”
Additional features as a paid monthly subscription
Goal: “start generating some of our own revenue.”
Go-to-market / visibility


Use campaign trail to:
Showcase the app
Explain “why the independent movement is important”
Demonstrate the tool for “transparency and legislation”
Future plans once on the App Store:
Demonstrate at “tech conferences”
Go “to go and network and stuff”
You agreed to attend/participate in such demos with her.
Timeline & bandwidth constraints


Her constraints:
Running for Lieutenant Governor as running mate to Brad Kohler
Still has a job and “a million and one things going on”
Your constraints:
“Overwhelmed across so many things”
Travel to SF, multi‑project workload
She expects:
Schedule will be tight through November
“After November, I will have a lot more time to dedicate to the app more fully.”
For now: treat things as “fluid,” “play it by ear,” “start the process and keep in contact.”

Every detail about the app (as discussed)
Problem it solves


Legislators currently:
“Save each individual bill”
“Have to run it through AI” one by one
The app centralizes and automates this workflow, acting as a “lifesaver” for them.
Users / customers envisioned


Primary:
Legislators
Secondary:
Lobbyists
Potentially government institutions (e.g., legislature) who might pay for usage
Political/party use:
Forward Party / independent movement
Andrew Yang as a potential champion/use‑case
Core concept


App focused on:
Legislative transparency
Bills, legislators, and related data
Using AI to analyze or process bills (implied by comparison to current “run it through AI” workflow)
Used as:
A practical tool for professionals
A showcase for transparency and independent politics
Technical constraints / status


Current/previous base:
“I don’t think base 44 is going to be able to hold the entire app.”
“That’s why we’re getting off of it. I saw it right away. It has different constraints.”
Need:
New tech stack that’s scalable and unconstrained vs. base 44
A dedicated technical owner (possibly Joe, but you want the right person)
Data requirements


Up-to-date, accurate data on:
Legislators (names, positions, etc.)
Bills and their relationships to legislators
Joe to help:
Organize/update this in a spreadsheet or similar
Data quality is a hard requirement before:
App Store launch
Wider rollout and demos
Feature requirements (MVP level)


Users:
Ability to create a profile
Ability to sign in (authentication)
Data:
Correct mapping between bills and legislators
Reliable legislator list and bill list
Platform:
Published as a mobile app (App Store specifically mentioned)
Post‑MVP:
“Add more features” after funding and usage validation
Funding and growth path


Stage 1:
Use her personal funds to:
Pay a developer to build the MVP
Get to App Store launch
Stage 2:
With initial users + App Store presence:
“Go and try to raise money”
Use metrics/traction to support fundraising
Stage 3:
Expand features and team after fundraising
Explore government / lobbyist / subscription revenue
Strategic positioning


Aligned with:
Independent / Forward Party brand
Messaging around transparency in legislation
Campaign synergy:
App used as a differentiator on the campaign trail
Show, not just tell, how independent candidates can improve process
If you want, next step could be a one‑pager product spec for the MVP (problem, users, key flows, data, and must‑have features) that you can share with potential developers and investors.
App for legislators
Legislators’ current workflow (saving each bill, running each through AI).
Strong positive feedback; viewed as a “lifesaver.”
Concern that Base 44 can’t support the full app; need new, scalable stack.
Need accurate legislator and bill data; Joe to help via spreadsheet.
Need MVP with profiles/sign‑in and App Store launch.
Potential monetization via government, legislators, lobbyists; free basic + paid tiers.
Use app on campaign trail and at tech conferences to showcase legislative transparency.
Budgeting a one‑time 0→1 dev cost; finding a developer to own build/maintenance.
Longer‑term: raise capital after MVP and initial users.
