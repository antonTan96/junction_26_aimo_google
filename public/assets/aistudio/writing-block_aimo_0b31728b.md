# 48-Hour Hackathon: Product Ideation, Competitive Analysis, Feasibility Evaluation & Execution Planning

## 1. Your Role and Objectives

Act as an experienced product strategist, startup analyst, UX designer, technical architect, and hackathon mentor.

Your task is to analyse the given problem statement, identify meaningful product opportunities, generate innovative product concepts, critically evaluate them, and recommend the strongest concept to develop within a 48-hour hackathon.

Approach the problem from two perspectives simultaneously:

**Product Perspective**
- Is this a meaningful problem that users actually experience?
- Does the proposed solution address an underserved need?
- Is the product desirable, differentiated, and potentially viable?
- Does it provide a compelling value proposition compared with existing alternatives?

**Engineering Perspective**
- Can a small team realistically build a functional prototype within 48 hours?
- Are the necessary technologies, APIs, infrastructure, and resources accessible?
- Can the product's differentiating feature be implemented within the available time?
- Can the final prototype be demonstrated reliably?

Do not optimise solely for technical novelty, business potential, or the number of features.

The objective is to find the strongest balance between user value, technical feasibility, product differentiation, and demonstration impact.

---

# 2. Input and Hackathon Context

## 2.1 Problem Statement (Theme)


### The Idea
Every revolution begins with someone unwilling to accept the current model.

When Copernicus moved the Earth from the center of the universe, he did not discover a new star. He refused to accept where everyone had placed the center of gravity. The Renaissance was not an accident of timing. It had a center, and someone had to move it.

### Problem Statements
I am interested in the following problems:
#### 1. Trusted Trade Agents

The Challenge

How can a food-service wholesaler let autonomous purchasing agents place an order – finding products, comparing offers and getting the right approval in a fraction of the time it takes today – without exposing real systems, confidential data or the marketplace roadmap?

B2B ordering in foodservice and wholesale is still largely manual or menu-driven: a buyer logs into today's Valio Aimo webshop and searches a catalog. The step we want to explore is external purchasing agents that find, compare, order and handle exceptions on the buyer's behalf, working with Valio Aimo directly – not by building a whole marketplace, but by defining the interface and operating model through which an external agent could interact with Valio Aimo's systems at all.

Core – your solution must enable:
* Product, price & availability lookup: a structured way for an external agent to search for and retrieve what's available and at what price.
* Requesting price & availability, then placing an order: a defined interaction for moving from inquiry to commitment, based on fixed prices rather than a negotiated quote.
* Permission & human-approval management: what the agent may decide on its own, and what must go to a human for sign-off.

Example request
```
"I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."
```

A hotel chain's agent sends this request. Your solution returns products, prices and availability in structured form; the agent places the order within its authority or sends it to a human for approval.

Impact: This is not about replacing today's e-commerce UI with a chatbot. It is about defining how a European food-service wholesaler can be safely and openly readable by autonomous agents – before that interface gets defined by someone else's platform.

## 2.2 Sponsor Technologies

The hackathon may provide access to sponsor technologies, platforms, APIs, development tools, services, and resources.

Use the following list as the available sponsor technology ecosystem:

* 200 Verda Credits for AI compute and inference API
* MariaDB
* 50 Aiven Credits
* CRACI Platform
* Oxylabs WebAPI
* Exa Credits
* Hostinger


Where applicable, additional information may be provided:

- Sponsor-provided API keys or credentials.
- Free credits or usage allowances.
- Special developer access or premium features.
- Documentation and integration guides.
- Technical support or developer resources.
- Any restrictions imposed by the hackathon organisers.

**Important:** Sponsor technologies are optional resources, not mandatory technology choices. Incorporate them only when they provide genuine value to the proposed solution.

You are permitted to recommend non-sponsor technologies where they are more suitable, provided they offer a reasonable free tier or free-to-use option sufficient for developing, testing, and demonstrating the hackathon MVP.

Do not force sponsor technologies into the architecture simply to demonstrate their usage.

## 2.3 Team and Development Context

Unless additional information is provided, use the following assumptions:

- **Duration:** 48 hours, including development, integration, testing, and presentation preparation.
- **Team:** A small multidisciplinary team with varying technical capabilities.
- **Resources:** Access to common development frameworks, open-source tools, APIs, pre-trained models, and cloud services where available.
- **Deliverable:** A functional prototype or MVP.
- **Demonstration:** The core value proposition should be communicated through a compelling 2–3-minute demonstration.
- **Budget:** Prefer free and sponsor-provided resources. Avoid relying on paid services unless the organisers explicitly provide sufficient credits.
- **Infrastructure:** Do not assume access to expensive GPUs, proprietary datasets, specialised hardware, or enterprise infrastructure unless explicitly provided.

## 2.4 Additional Hackathon Information (If Available)

- Team size: 1

---

# Phase 1: Problem Discovery and Analysis

Before proposing solutions, establish a thorough understanding of the problem space.

## 1.1 Problem Deconstruction

Analyse the problem statement across the following dimensions:

- **Problem definition:** What exactly is the underlying problem? Distinguish root causes from visible symptoms.
- **Target users:** Who experiences this problem? Identify primary users, secondary users, and other stakeholders.
- **User needs:** What are users attempting to accomplish?
- **Pain points:** Where do users experience inefficiency, friction, cost, risk, inconvenience, or dissatisfaction?
- **Problem severity:** How frequent, urgent, and consequential is the problem?
- **Current workarounds:** How do users currently address the problem?
- **Unmet needs:** What aspects of the problem remain inadequately addressed?
- **Underlying assumptions:** What assumptions are implicit in the problem statement, and which require validation?

## 1.2 Problem Prioritisation

Identify the most promising pain points based on:

- Severity of the problem.
- Frequency of occurrence.
- Number of affected users.
- Existing dissatisfaction with available alternatives.
- Potential improvement in user outcomes.
- Whether the problem is sufficiently specific to address within a hackathon.

Distinguish between:
1. Problems that are genuinely worth solving.
2. Problems that are inconvenient but provide little motivation for users to adopt a new solution.
3. Problems that are too broad or complex to address meaningfully within 48 hours.

**Output:** A concise problem analysis identifying the three most promising user pain points and explaining why they deserve attention.

---

# Phase 2: Existing Solutions and Competitive Landscape

Research existing products, services, startups, open-source projects, and alternative approaches that address the problem or adjacent use cases.

Use current web research. Do not limit the analysis to direct competitors. Consider indirect competitors, manual processes, existing workarounds, and non-product alternatives.

## 2.1 Competitor Identification

Identify approximately 3–5 relevant competitors or alternative solutions.

For each, investigate:

| Dimension | Analysis |
|---|---|
| Product / Service | What does the solution offer? |
| Target Users | Who uses it? |
| Value Proposition | What problem does it solve? |
| Core Features | What are its main capabilities? |
| Strengths | What does it do particularly well? |
| Weaknesses | What limitations or gaps exist? |
| Differentiation | How does it distinguish itself? |
| Business Model | How does it generate revenue, if applicable? |
| User Feedback | What do users appreciate or complain about? |

## 2.2 Identify Competitive Gaps

Investigate:

- Frequently reported user frustrations.
- Important features missing from existing solutions.
- Underserved user segments.
- Barriers to adoption, such as cost, accessibility, complexity, trust, or availability.
- Opportunities to improve existing workflows.
- Opportunities to combine capabilities in a way that creates meaningful user value.

## 2.3 Competitive Positioning

Summarise the competitive landscape and identify:

1. What existing solutions already do well.
2. Where existing solutions consistently fall short.
3. Which user needs remain underserved.
4. Where a new solution could provide meaningful differentiation.
5. Which proposed approaches would merely replicate existing products.

**Research standards:**

- Prioritise primary sources, official product documentation, pricing pages, product demonstrations, research papers, and credible user feedback.
- Use Reddit and other relevant user communities where they provide useful first-hand experiences.
- Cite sources for factual claims.
- Do not fabricate competitor capabilities, statistics, pricing, or market demand.
- Clearly distinguish verified information from assumptions.
- Do not describe an idea as innovative simply because it uses AI, automation, or a combination of existing technologies.

**Output:** A concise competitor comparison matrix, followed by 3–5 actionable opportunities for differentiation.

Keep research proportional to the hackathon context. Focus on finding product gaps rather than producing an exhaustive industry report.

---

# Phase 3: Product Ideation

Based on the problem analysis and competitor research, generate **3–5 distinct product concepts**.

Explore different solution directions rather than generating superficial variations of the same concept.

Potential directions include:

- Improving existing workflows or processes.
- Automating repetitive or inefficient tasks.
- Making existing capabilities more accessible or affordable.
- Connecting fragmented systems, stakeholders, or information.
- Applying AI, machine learning, computer vision, or automation where they provide a demonstrable advantage.
- Addressing overlooked user segments or edge cases.
- Redesigning an existing approach to solving the problem.

## 3.1 Product Overview

For each concept, provide:

- **Product name:** A concise and memorable name.
- **Elevator pitch:** Explain the product in 1–2 sentences.
- **Problem addressed:** Which specific pain point does it solve?
- **Target users:** Who would use it?
- **Proposed solution:** How does the product work?
- **Value proposition:** Why would users choose it over existing alternatives?
- **Differentiation:** What makes it meaningfully different?
- **Potential impact:** What improvement could it deliver?

## 3.2 Core Features

Identify 3–5 potential features.

For each feature, explain:

- What it does.
- Which user problem it solves.
- Why it is necessary.
- Whether it is essential to demonstrating the product's value.

## 3.3 User Journey

Describe a realistic end-to-end user interaction:

1. What triggers the user to use the product?
2. What information or input does the user provide?
3. What does the product do?
4. What does the user receive?
5. What meaningful outcome does the user achieve?

Avoid describing features without explaining how they contribute to the user experience.

---

# Phase 4: Product Evaluation — Desirability, Feasibility and Viability

Evaluate every concept using the three fundamental dimensions of product design.

## 4.1 Desirability — Do People Actually Want It?

Evaluate:

- Does it solve a genuine user problem?
- Is the problem frequent, severe, or important enough to motivate adoption?
- Is the target audience clearly identifiable?
- Does the proposed solution improve upon current alternatives?
- Is the user experience intuitive and convenient?
- Would users realistically adopt the solution?
- Is there supporting evidence of demand, or is demand merely assumed?

## 4.2 Feasibility — Can We Build It?

Assess feasibility specifically within a 48-hour hackathon.

Evaluate:

- Can the core functionality be implemented with existing technologies?
- Are suitable APIs, libraries, datasets, models, and services available?
- Does the implementation require specialised expertise?
- What are the most technically challenging components?
- Can the differentiating feature be completed within the development window?
- Can the prototype function reliably?
- Are there integration dependencies that could jeopardise completion?

Distinguish between:

**Hackathon feasibility:** Can the team build a convincing, functional MVP within 48 hours?

**Long-term technical feasibility:** Can the solution eventually be developed into a reliable, production-quality product?

Hackathon feasibility should carry significantly more weight.

## 4.3 Viability — Is There a Sustainable Opportunity?

Evaluate:

- Who benefits from the solution?
- Who would pay for it, if applicable?
- Is there a plausible business or operational model?
- What are the potential operational and maintenance costs?
- Are there legal, regulatory, or organisational barriers?
- Can the solution scale beyond the initial user group?
- Is there a credible opportunity for adoption after the hackathon?

For public-good or non-commercial products, assess institutional adoption, funding, and operational sustainability instead of forcing a conventional revenue model.

Keep this assessment proportional to the early-stage nature of a hackathon prototype.

---

# Phase 5: Additional Product Design Considerations

Evaluate each concept against the following considerations.

## 5.1 User Experience and Accessibility

- Is the interface intuitive?
- Does the product minimise unnecessary cognitive load?
- Can users with different levels of technical proficiency use it?
- Does it accommodate relevant accessibility requirements?
- Are edge cases and error states considered?

## 5.2 Privacy, Security and Trust

- Does the solution collect or process sensitive information?
- Is data collection necessary and proportionate?
- What security vulnerabilities might exist?
- Can users understand and trust the product's outputs?
- Are there safeguards against misuse?

## 5.3 Social and Ethical Impact

- Could the solution introduce bias or unequal access?
- Could it cause unintended harm?
- Are there negative environmental or societal implications?
- Does it support responsible and inclusive design?

## 5.4 Scalability and Maintainability

- Can the architecture support increasing usage?
- Are there excessive infrastructure or third-party dependencies?
- Can the product be extended without substantial architectural rework?

## 5.5 Differentiation and Defensibility

- Does the solution provide a meaningful advantage over competitors?
- Is the advantage based on better user outcomes rather than superficial features?
- Could competitors easily replicate it?
- Does it have potential long-term advantages through data, integrations, network effects, or workflow adoption?

---

# Phase 6: Hackathon-Specific Feasibility and Execution Analysis

This phase is critical. Evaluate the ideas as prototypes that must actually work within 48 hours, not as fully developed commercial products.

## 6.1 MVP Definition

For every concept, identify:

- **Core value proposition:** What is the one thing the product must demonstrate?
- **Minimum viable functionality:** What is the smallest functional implementation that proves the concept?
- **Must-have features:** Essential for the demonstration.
- **Should-have features:** Valuable but removable under time pressure.
- **Could-have features:** Additional functionality only to be attempted if the MVP is complete.
- **Explicit exclusions:** What should not be built during the hackathon?

Be strict about scope. Avoid features that increase implementation complexity without substantially improving the product's core value.

## 6.2 Technology Selection and Implementation Assessment

The hackathon may provide a list of sponsor technologies, platforms, APIs, frameworks, and development tools. These should be considered as potential resources for building the proposed solutions.

However, **the use of sponsor technologies is encouraged but not mandatory**.

Do not force a sponsor technology into the architecture if it does not meaningfully contribute to the product's functionality, differentiation, implementation efficiency, or overall feasibility.

### A. Available Sponsor Technologies

Use the sponsor technology list provided in section "Sponsor Technologies" in the hackathon context.


For each proposed product concept:

1. Identify which sponsor technologies are relevant.
2. Explain what functionality each relevant technology provides.
3. Assess whether it offers a meaningful advantage over alternative technologies.
4. Determine whether it can realistically be integrated within the 48-hour development window.
5. Identify limitations, dependencies, setup requirements, pricing, or usage restrictions.
6. Explicitly identify sponsor technologies that should not be used and explain why they are unsuitable or unnecessary.

Do not recommend sponsor technologies merely to satisfy a perceived expectation from the hackathon organisers.

### B. Technology Stack Recommendations

For each concept, recommend an appropriate technology stack covering, where relevant:

- Frontend frameworks and UI libraries.
- Backend frameworks and application infrastructure.
- Databases and data storage.
- AI/ML models, inference platforms, and development tools. NVIDIA Nemotron 3.5 Super VL is preferred. 
- APIs and external integrations.
- Authentication and security.
- Hosting and deployment.
- Specialised hardware or development tools.

Consider the following technology selection priorities:

1. **Relevant sponsor technologies:** Prefer these when they provide a genuine functional, technical, or implementation advantage.
2. **Non-sponsor technologies with free tiers:** Consider alternatives when they are better suited to the requirements and provide sufficient free usage.
3. **Open-source and self-hosted alternatives:** Consider these when they reduce cost, external dependencies, or integration risks, provided they can be configured within the hackathon timeframe.

The final choice should be based on product requirements and implementation feasibility, not sponsorship status.

### C. Free-Tier and Cost Requirements

Any non-sponsor technology recommended must have a reasonable free tier or free-to-use option sufficient for the hackathon MVP.

Assess the following:

- Are the essential features available without payment?
- Are the free-tier usage limits sufficient for development, testing, and the final demonstration?
- Are there API request limits, inference quotas, storage restrictions, or execution limits?
- Does the service require a credit card or paid subscription to access essential functionality?
- Are there restrictions on commercial use, data processing, or deployment?
- Could usage costs unexpectedly arise during the hackathon?
- Is account verification or approval required before the technology can be used?
- Does the free offering have any other limitations that could jeopardise the final demonstration?

A free tier does not need to support production-scale usage. However, it must be sufficient to build and reliably demonstrate the proposed MVP.

Do not recommend a paid-only service or a free trial that expires before the hackathon demonstration unless an alternative implementation is provided.

For sponsor technologies, account for any free credits, special access, or usage allowances explicitly provided by the organisers. Do not assume that sponsor access is unlimited.

**Research requirement:** Verify current pricing and free-tier information using official documentation and pricing pages wherever possible. Distinguish verified information from estimates or assumptions.

### D. Technology Comparison

For each important technology component, provide a comparison where relevant:

| Dimension | Sponsor Technology | Alternative Technology |
|---|---|---|
| Functionality | What it offers | What it offers |
| Suitability | How well it fits the product | How well it fits the product |
| Integration Effort | Setup and development complexity | Setup and development complexity |
| Free-Tier Availability | Provided credits, limits and restrictions | Free usage limits and restrictions |
| Performance | Relevant capabilities and limitations | Relevant capabilities and limitations |
| Documentation | Quality and accessibility | Quality and accessibility |
| Hackathon Risk | Potential integration or usage risks | Potential integration or usage risks |
| Recommendation | Use / Do not use | Use / Do not use |

Do not compare technologies unnecessarily when there is an obvious choice.

### E. Final Technology Stack Recommendation

For each concept, identify:

1. **Recommended technology stack:** The specific technologies to use for the hackathon MVP.
2. **Sponsor technology utilisation:** Which sponsor technologies should be incorporated and how they contribute to the product.
3. **Non-sponsor technologies:** Additional technologies recommended, with justification for selecting them over sponsor alternatives.
4. **Free-tier verification:** Availability and relevant limitations of free usage for each non-sponsor service.
5. **Estimated cost:** Any likely cost during development and demonstration.
6. **Integration strategy:** How the different components will interact.
7. **Fallback options:** Alternative technologies or implementation approaches if a selected service becomes unavailable, exceeds its free-tier quota, or proves difficult to integrate.

**Technology Selection Principle:**

Choose the technology stack that maximises the probability of delivering a functional, differentiated, and reliable prototype within 48 hours.

Sponsor technologies should be leveraged when they provide genuine value, but they should never compromise product quality or implementation feasibility.

Non-sponsor technologies are acceptable provided they have a reasonable free tier or free-to-use alternative sufficient for the hackathon MVP.

## 6.3 Technical Risk Assessment

Identify potential implementation bottlenecks, including:

- API availability and rate limits.
- Model inference latency and cost.
- Dataset quality and availability.
- Third-party service reliability.
- Hardware requirements.
- Authentication and deployment difficulties.
- Internet connectivity.
- Integration between independently developed components.

For each significant risk, provide:

1. Likelihood of occurrence.
2. Potential impact on the project.
3. Mitigation strategy.
4. Alternative implementation or fallback approach.

Where appropriate, identify functionality that can be mocked or simulated without undermining the credibility of the demonstration.

## 6.4 Time-to-Value

Assess how quickly the team can produce the first meaningful working functionality.

Consider:

- How long before a basic prototype becomes functional?
- How many development steps are required before the core value can be demonstrated?
- Does the product depend on extensive initial configuration?
- Is the most innovative component achievable within the time constraint?

A solution that takes 20 hours before producing any meaningful demonstration carries substantial execution risk.

## 6.5 Demo Impact

Evaluate whether the product can communicate its value within 2–3 minutes.

Consider:

- Is the underlying problem immediately understandable?
- Can judges see the product solving the problem?
- Is there a tangible before-and-after comparison?
- Does the demonstration highlight the product's unique differentiator?
- Is the experience interactive and memorable?
- Can the demonstration run reliably without excessive setup?

Avoid ideas whose primary value is difficult to demonstrate visually or interactively.

## 6.6 Hackathon Suitability

Evaluate whether the idea can achieve all of the following:

- A functional end-to-end workflow.
- A meaningful differentiating feature.
- A polished enough user experience for demonstration.
- A reliable prototype with manageable dependencies.
- A clear explanation of user value.

Prefer a smaller, fully functional product over an ambitious prototype with several incomplete features.

---

# Phase 7: Quantitative Scoring and Idea Ranking

Score each concept using the following weighted evaluation framework.

| Criterion | Weight |
|---|---:|
| Desirability — Real user need and demand | 15% |
| Feasibility — Achievable within 48 hours | 25% |
| Demo Impact — Quality and memorability of demonstration | 20% |
| Differentiation — Competitive advantage | 15% |
| User / Societal Impact | 10% |
| Viability — Potential beyond the hackathon | 5% |
| UX and Accessibility | 5% |
| Privacy, Security and Ethics | 5% |
| **Total** | **100%** |

Use a 1–5 rating scale:

- 1 = Very poor
- 2 = Poor
- 3 = Average / acceptable
- 4 = Good
- 5 = Excellent

Calculate the weighted score using:

Weighted Score = Sum of (Criterion Score / 5 × Criterion Weight)

Present the results in a comparison table.

For each rating:

- Explain the rationale.
- Identify supporting evidence.
- State any assumptions that could change the rating.
- Indicate confidence: High, Medium, or Low.

### Critical Scoring Rules

1. Do not inflate scores because an idea sounds innovative or uses advanced technology.
2. Distinguish between evidence-supported desirability and speculative demand.
3. A high overall score must not conceal a serious weakness in any of the three product design dimensions.
4. Flag any concept scoring below 3/5 in desirability, feasibility, or viability as a significant risk.
5. Do not penalise non-commercial products simply because they lack conventional monetisation.
6. Prioritise actual hackathon execution and demo potential over speculative long-term business potential.

After ranking the concepts, explain the trade-offs between the highest-scoring ideas.

---

# Phase 8: Deep Dive Into the Recommended Idea

Select **one strongest concept** based on the combined evaluation.

Do not automatically choose the idea with the highest numerical score if another concept presents a materially better balance of user value, execution reliability, and demonstration potential.

Explain any deviation from the ranking.

Conduct a detailed product and engineering breakdown.

## 8.1 Product Definition

Provide:

- Product vision.
- Core value proposition.
- Primary user persona.
- Specific problem being solved.
- Desired user outcome.
- Unique selling proposition.
- Competitive positioning.

Explain why the target user would choose this solution instead of existing alternatives.

## 8.2 End-to-End User Journey

Describe the full interaction flow:

1. User entry point.
2. Input and onboarding.
3. Core product interaction.
4. Processing and system behaviour.
5. Output or result.
6. User's final outcome.

Identify the critical interaction that demonstrates the product's unique value.

## 8.3 MVP Feature Specification

Organise features into:

**Must Have:** Essential for the final demonstration.

**Should Have:** Improves the experience but can be removed.

**Could Have:** Optional enhancements.

For every must-have feature, specify:

- Its purpose.
- Expected behaviour.
- Technical implementation.
- Dependencies.
- Acceptance criteria.

Make sure the features collectively demonstrate the complete core value proposition.

## 8.4 High-Level Technical Architecture

Propose a practical architecture for the hackathon MVP.

Include:

- Frontend components.
- Backend services.
- Database or data storage, if necessary.
- APIs and external integrations.
- AI/ML components, if applicable.
- Data flow between components.
- Deployment architecture.

Explain how the components interact.

Recommend an implementation strategy that minimises integration overhead and unnecessary infrastructure.

Where appropriate, identify alternative implementations that are easier or safer to deliver within 48 hours.

## 8.5 Validation and Success Metrics

Identify the assumptions most likely to invalidate the idea.

Propose lightweight methods to validate:

- User demand.
- Usability.
- Technical performance.
- Accuracy or reliability, where relevant.
- Improvement over existing alternatives.

Define measurable success criteria for the hackathon prototype.

Do not confuse a successful demonstration with proven product-market fit.

---

# Phase 9: 48-Hour Development Roadmap

Produce a realistic implementation plan for the recommended idea.

Divide the timeline into practical milestones.

| Time | Phase | Expected Deliverable |
|---|---|---|
| Hours 0–2 | Finalise scope | Problem definition, user journey, MVP and feature priorities |
| Hours 2–4 | Technical setup | Repository, development environment, architecture and task allocation |
| Hours 4–12 | Core development | First working version of essential components |
| Hours 12–24 | Functional MVP | Primary user journey working end to end |
| Hours 24–30 | Differentiation | Core innovative feature implemented and integrated |
| Hours 30–36 | Integration | Full application workflow connected |
| Hours 36–40 | Testing and stabilisation | Critical bugs fixed, fallbacks implemented |
| Hours 40–44 | UX and presentation | Interface polish, demo data and presentation |
| Hours 44–48 | Final preparation | Rehearsed demonstration, final testing and submission |

Adjust these milestones according to actual technical complexity. Do not treat the timeline as fixed if components can be developed in parallel.

## 9.1 Team Task Allocation

Recommend task allocation for a small team.

Identify:

- Frontend responsibilities.
- Backend responsibilities.
- AI/ML or technical integration responsibilities, if applicable.
- Product design and UX responsibilities.
- Integration and testing ownership.

Account for dependencies between tasks and recommend parallel development wherever practical.

Avoid assigning multiple team members to tightly coupled components without clear interface contracts.

For a team of unknown size, provide a suggested modular allocation that can be adapted to the actual number of members.

## 9.2 Demo Preparation

Define a compelling 2–3-minute demonstration:

1. Introduce the user problem.
2. Show the existing friction or limitation.
3. Demonstrate the product's core workflow.
4. Highlight the unique differentiating feature.
5. Show the outcome and impact.

Also provide:

- A reliable demo dataset or scenario.
- A fallback demonstration in case external services fail.
- A short list of features that should not be attempted near the deadline.

---

# Phase 10: Final Recommendation

Conclude with a decisive recommendation.

Address the following:

1. Which concept should the team build?
2. Why is it preferable to the other concepts?
3. What specific user pain point does it solve?
4. What makes it different from existing alternatives?
5. Why is it achievable within 48 hours?
6. Which sponsor technologies, if any, should be used?
7. Why are the selected technologies preferable to the alternatives?
8. What is the strongest feature to showcase?
9. What is the biggest implementation risk?
10. What should the team deliberately avoid building?
11. What should the final demonstration look like?
12. What is the product's potential beyond the hackathon?

End with a concise explanation answering:

**If you were participating in this hackathon, which idea would you choose to build, which technologies would you use, and how would you maximise its chances of being both successfully implemented and compelling to judges?**

---

# General Research and Reasoning Standards

Throughout the entire process, follow these principles.

## Product Thinking

- Start with the user problem, not the technology.
- Evaluate actual user needs rather than hypothetical feature preferences.
- Identify root causes instead of treating symptoms.
- Do not force a solution where the problem does not justify one.
- Prioritise meaningful improvements to existing user experiences.

## Competitive Analysis

- Research existing alternatives before claiming novelty.
- Consider direct competitors, indirect competitors, and non-product alternatives.
- Ground claims in credible and current sources.
- Identify genuine market gaps rather than inventing them.

## Technical Thinking

- Prioritise technologies that can be implemented and integrated quickly.
- Prefer relevant sponsor technologies when they provide a genuine advantage.
- Do not treat sponsor technologies as mandatory.
- Ensure non-sponsor technologies have sufficient free usage for the hackathon MVP.
- Verify current free-tier limits, restrictions, and pricing using official sources.
- Avoid unnecessary infrastructure and overengineering.
- Identify technical dependencies early.
- Plan fallback approaches for components that could fail.
- Distinguish mocked functionality from genuinely implemented functionality.

## Hackathon Strategy

- Optimise for a working end-to-end experience.
- Prioritise the feature that makes the product different.
- Minimise scope without compromising the core value proposition.
- Reserve sufficient time for integration, testing, and demo preparation.
- Avoid ideas that depend on too many uncertain external factors.

## Intellectual Honesty

- Explicitly distinguish facts, assumptions, hypotheses, and recommendations.
- Never fabricate market statistics, user feedback, competitor capabilities, pricing, or technical feasibility.
- Identify information gaps and uncertainties.
- Challenge weak concepts instead of trying to justify every idea.
- Explain the trade-offs behind recommendations.

## Output and Analysis Discipline

- Structure the analysis using the phases above.
- Use comparison tables where they improve clarity.
- Cite external sources for researched claims.
- Keep the ideation and evaluation focused on actionable insights.
- Avoid unnecessarily lengthy market research that does not influence the final decision.
- Be decisive when recommending a concept and explain the reasoning behind the decision.

---

# Ultimate Objective

Identify a product concept that:

1. Solves a real and meaningful problem.
2. Addresses a genuine gap in existing solutions.
3. Is desirable to its intended users.
4. Is technically feasible within 48 hours.
5. Offers meaningful differentiation.
6. Makes effective use of sponsor technologies where appropriate.
7. Can be built using accessible technologies and reasonable free-tier resources.
8. Has a compelling and reliable live demonstration.
9. Is responsibly designed.
10. Has credible potential for further development beyond the hackathon.

**The goal is not to build the most ambitious product or use the most sponsor technologies. The goal is to build the most valuable, differentiated, and demonstrable product that can realistically be delivered within the available 48 hours.**