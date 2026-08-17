# Alethical Philosophy

**The pitch.** Minnesota publishes everything its legislature does, in a format almost
no one can read. Alethical turns that record — bills, votes, legislators, campaign
money — into plain language, so anyone can see what their government is doing and check
every word against the official source.

## What the app does

1. **Every Minnesota bill, in plain language** — what it does, where it stands, and who
   authored it, with the official text one click away.
2. **Every roll-call vote** — how each legislator actually voted, linked to the
   official record.
3. **A profile for every legislator** — their bills, their votes, and the campaign
   money around them, drawn from official filings.
4. **Ask in your own words** — a question gets an answer built only from the official
   record, with citations, or an honest "we can't answer that." Never a stretch.
5. **Every page is a link worth sending** — arrive in the middle of the product from a
   shared URL and it still makes sense, with the way back to the source in view.

This list is the product's shape; what is shipped at any given moment is the
[product scope](product-onboarding/product-scope.md)'s job to say, and the principle
*say only what we can do* keeps every concrete promise honest.

## What this file is

The *why* beneath Alethical — the beliefs that should hold even as features, copy, and
design change around them. It sits above the operational docs:
[product scope](product-onboarding/product-scope.md) says *what we build and won't build*,
[design principles](design/design-principles.md) says *how it looks and behaves*, and
the [UI copy guide](design/ui-copy-guide.md) says *how it sounds*. Those are rules and
tactics; this is the direction they answer to.

It is not a feature spec. Nothing here describes a screen, a state, or a component; if
a sentence would go stale the next time a screen changes, it belongs in a spec, not
here. And these are principles, not a checklist: where one seems to conflict with a
concrete capability, the [grounded-answer invariants](../.claude/rules/grounded-answers.md)
win — a thing must be *true* before it can be on-philosophy.

---

## The problem: legibility, not secrecy

Minnesota already publishes all of it. Bill text, authorship, committee actions, roll
calls, and enacted chapters are public, on official sites, updated while the session
runs. There is no locked door, and nothing here was ever kept from anyone. The record
was always the public's to read.

What exists instead is a format addressed to people who already know the system. A bill
arrives as a number, a chain of procedural actions, and pages of amendatory text that
reads as edits to statute rather than as a description of anything. Following it takes
knowing what a committee referral means, that a bill usually has a twin in the other
chamber, and which of several near-identical versions is the one that passed. A reader
without that knowledge doesn't get a wrong answer. They get no answer, and they stop.

So the barrier is legibility, and that decides what we are. Not an exposé, not a
watchdog uncovering what someone hid, not a scorecard — nothing here is hidden, and
staging it as hidden would be its own dishonesty. We remove the format barrier and
nothing else. The competition is not another website; it is the moment a person decides
this isn't for them and closes the tab. It is also why provenance is never negotiable
here: the record is public, so there is no case where we couldn't point straight at it.

---

## Who we assume is reading

Every principle below presumes a particular reader. Writing them down makes them
arguable, which is the point — these are assumptions we chose, not findings we measured.
We hold ourselves to principle 1 as well, so where evidence arrives and contradicts one,
the evidence wins and this section changes.

- **We optimize for the person who has none of the context.** The [README](../README.md)
  mission names citizens, journalists, and legislators, and all three are welcome. But
  journalists and legislative staff arrive already fluent and already tooled. Serving
  someone is not the same as optimizing for them: when a tradeoff pulls between the
  fluent reader and the newcomer, the newcomer wins.
- **They arrive with a worry, not a research question.** Something specific happened, or
  they heard something and want to know whether it's real. Nobody shows up wanting to
  browse legislation.
- **They don't know the words or the process.** Not author versus sponsor, not what a
  committee referral is, not that a bill usually has a twin in the other chamber.
  Anything that needs that knowledge just to begin does not work.
- **They don't know the bill by name.** They know the subject. Every way in has to start
  from what a person actually holds in their head.
- **They have minutes.** The plain sentence has to land first, with the detail underneath
  for the reader who wants it and out of the way of the reader who doesn't.
- **They arrive skeptical of government and of AI in equal measure.** Trust is not the
  starting condition; each screen either earns it or spends it. This is why a visible way
  back to the source beats a confident tone, every time.
- **They come rarely, and often from a link someone sent them.** Not a daily habit: read
  one thing, leave. So every place worth landing on has to be a URL of its own, and the
  product has to make sense to someone who arrived in the middle of it.

---

## Principles

### 1. Truth before voice

Accuracy and persuasion sometimes pull in different directions. When they do, accuracy
wins — every time. A line must be true before it can be compelling. An honest "we can't
answer that" is a better product than a confident stretch, and refusing to overreach is
a feature, not a failure.

### 2. Uncover, don't translate

We are not an interpreter standing between the citizen and the record, restating it in
our own voice. We remove what conceals it. Make the government's own words legible, in
plain language, and always keep the path back to the source in view. Provenance is not a
citation footnote — it is the physical proof of this principle.

**Truth unconcealed includes the public records that show money, access, and organized
influence around government.** Official campaign-finance filings and lobbying disclosures
are in bounds. We may show and connect what those records document: who gave, who received,
who registered, which bill or issue a filing names, how much, and when. We do not turn
proximity into proof. A disclosed relationship is a fact; motive, causation, and corruption
are separate claims that require their own direct evidence.

### 3. The record is theirs, not ours

Frame access as something restored, never as a favor we grant. *Your* representatives,
*your* district, *your* vote. We are the lens, not the owner, and never the gatekeeper.
Language that casts us as the authority and the user as a supplicant is off-philosophy
even when it's technically accurate.

### 4. Say only what we can do

Never advertise a capability we haven't shipped, and never name an intent we can't
actually answer. Voice may gesture at the horizon; every specific promise on a surface
must resolve to something real. When a capability slips, trim the claim in the same
breath — the alternative is a small lie, and a small lie in a truth product is a large one.

### 5. Meet people in their own words

Use the word a regular person reaches for, not the institution's term of art — even when
the term of art is more precise. The layperson's entry word wins at the surface; the
precise term keeps its place in the data model and the code. Precision the reader can't
parse isn't precision to them.

This also governs what we *put on a surface*, not only how we word what's already there.
Showing each bill's official statutory title under the plain-language headline is
perfectly accurate and still wrong: it puts back the legalese the product exists to
remove ([#731](https://github.com/alethical-org/alethical/issues/731)). The test is
*does this help someone understand what the bill does, or does it only prove we know the
legal wording?* The second kind stays reachable behind the source link, never pushed at
the reader.

### 6. One honest name

Name a thing for the promise it keeps, not the hype it can borrow. A good name tells the
truth about what the thing does and quietly signals what makes it different; a generic or
inflated name spends credibility we can't get back. If a name would flatter the feature
past what it delivers, it's the wrong name.

### 7. Craft is credibility

For a product whose entire value is being trustworthy, polish is not decoration — it is
evidence. The care visible in the small things is the same care the reader is trusting us
to have applied to the facts. Sloppiness doesn't just look unfinished; it reads as *maybe
they were this careless with the record too.*

### 8. Modesty is a feature

We would rather be a narrow product that is completely reliable than a broad one that is
occasionally wrong. Depth over breadth: do one jurisdiction, one job, completely, before
reaching for the next. Restraint is how a truth product earns the right to be believed.

### 9. Prevent, don't just fix

A fix restores what was working. Prevention removes the reason it broke. So when something
fails, the first question is not *how do we repair this* but *what would stop it happening
at all* — and when nothing has failed yet, ask it anyway. Reporting a problem to a human is
the last resort, not the design: an alert we have to read, a check someone has to remember,
a log nobody opens are all a failure we chose to keep and monitor. Prefer the change that
makes the failure impossible, and use notice-and-repair only for what prevention can't
reach. In a product whose value is being trustworthy, the errors that never happen are the
ones the reader never has to forgive.

### 10. We are not competing for attention

Anything that measures itself in time-on-site eventually optimizes for whatever holds
attention, and in this subject matter that thing is outrage. So we don't measure
ourselves that way. Someone who arrives with a question, gets a true answer with the
source in view, and leaves four minutes later is the best outcome this product has — not
a retention failure to be fixed.

The [scope](product-onboarding/product-scope.md) already reads this way: no social
features, no comment threads, personalization kept to tracked bills and saved places, one
quiet email when a tracked bill moves. Those are not gaps waiting to be filled. They are
the same decision, made over and over.

---

## The test for anything we make

> Does this help a person see the record that was always theirs — truthfully, in words
> they understand, with the way back to the source in plain view?

If it doesn't, or it can't do so honestly yet, it isn't ready. Everything else — the
copy, the layout, the roadmap — is in service of getting a real answer to that one question.
