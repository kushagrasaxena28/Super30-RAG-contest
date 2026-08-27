# AI RAG: Case Intelligence System

### Goal

Build a single-page web app where a user can ask open-ended questions about a given set of client transcripts + reference documents.

Your job is to build a RAG system that can retrieve the right information and use an LLM to answer the question accurately.

### Dataset

You will be given:

docs\_for\_test.zip

1.3 MiB

transcriptions\_for\_test.zip

196 KiB

#### Transcripts

Robert — 2 transcripts

Nathan — 3 transcripts

#### Documents

5 documents covering topics such as:

Policies

Services offered by agencies

Evidence-based practices

State standards for community corrections

### What Your App Should Answer

Your system should handle questions like:

"Did the case manager follow all of the check-in guidelines in the last meeting?"

"What are some key themes that Robert talks about?"

"What things seem to be important to Robert?"

"When should a client submit a grievance?"

"Did the case manager use the 2nd principle of effective intervention in their last meeting?"

"What do you think are the client's biggest risks/needs?"

"What is Nathan's relationship with his family like?"

Questions may require information from:

A single document

A single transcript

Multiple transcripts

Multiple documents

Both transcripts and documents (cross origin retrieval)

### Requirements

#### 1\. Real RAG

Do NOT send all documents and transcripts to the LLM for every question.

You must build an actual retrieval pipeline:

#### 2\. Run Locally

I should be able to clone your repository, add the required API keys, and run the application on my machine. I prefer a simple docker compose up cmd but feel free to build it your way

#### 3\. Source/Evidence

The answer should show the sources/evidence used to generate it.

For example:

Answer: Robert appears to be concerned about... Sources: - Robert Transcript 2 - Evidence Based Practices.pdf

​

#### 4\. Single Page

Keep the frontend simple.

At minimum:

Question input

Answer

Sources/evidence

Loading/error state

### Evaluation

The main thing being evaluated is how good your RAG system actually is.

We'll test it with questions that require:

Good retrieval

Cross-transcript reasoning

Document + transcript reasoning

Policy comparison

Recommendations

Summarization and theme extraction

We may also ask questions that you haven't seen before.

Do not hardcode answers for the example questions.

### Submission

Submit:

GitHub repository

Working application

README with setup instructions

.env.example

Short explanation of your RAG architecture

That's it.

The goal is simple: build the best possible RAG system for this dataset.