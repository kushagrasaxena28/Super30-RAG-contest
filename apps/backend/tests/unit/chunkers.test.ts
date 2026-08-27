import { describe, expect, test } from "bun:test";
import { chunkStandardsRegex, countStandardsHeadings } from "../../src/ingestion/chunkers/standardsRegex.js";
import { chunkWholeDoc } from "../../src/ingestion/chunkers/wholeDoc.js";
import { selectChunkStrategy } from "../../src/ingestion/strategySelect.js";
import { wordCount } from "../../src/ingestion/textUtils.js";
import { WHOLE_DOC_WORD_THRESHOLD } from "../../src/config/constants.js";
import type { ChunkerContext } from "../../src/ingestion/types.js";

const REF_CTX: ChunkerContext = { sourceType: "reference_document" };

/**
 * Trimmed from the real "2022 Colorado Community Corrections Standards"
 * (docs/docs_for_test) - same shape: a category breadcrumb line, then
 * `CODE-NNN: Title` headings with body paragraphs under each.
 */
const STANDARDS_FIXTURE = `Client Supervision (CS)

CS-010: Random Headcounts and Facility Walkthroughs
There shall be at least fourteen (14) random headcounts/walkthroughs conducted during each
calendar day at residential programs.

CS-020: Client Accountability
Programs shall maintain a system of accountability for client movement.

Client Development (CD)

CD-080: Enhance Intrinsic Motivation
The program shall have written policies, procedures, and established practices for
systematically enhancing intrinsic motivation for specific targeted behaviors.
`;

/**
 * The real docs/docs_for_test/check-in-guidelines.pdf, verbatim from
 * `pdftotext -layout`. 213 words, 11 numbered items. plan/11-delivery.md:
 * this document is deliberately NOT split, because "did the CM follow *all*
 * the guidelines" needs all 11 items in one chunk.
 */
const CHECKIN_GUIDELINES = `This document contains Johnson County Community Corrections policies for how to
conduct check-in meetings with clients. Please follow these guidelines when conducting a
meeting with a client:



   1. Conﬁrm the client's address. If it has changed, get the new address.
   2. Conﬁrm the client's phone number. If it has changed, get the new number.
   3. Conﬁrm the client's employment. If it has changed, understand why and get details.
   4. Conﬁrm the status of the latest drug screen with the client. If it was positive, have a
       conversation about why and what it means.
   5. If the client has an ankle monitor, check in to make sure they don't have any issues
       with it and if they do help them resolve them.
   6. Check in on any medications the client might be taking and ask about any changes
       to them.
   7. Check the status of user fees the client has. Let them know if they are caught up or
       owe money still.
   8. Ask the client if they've had any police contact. If they have ask why.
   9. Ask about the clients schedule and conﬁrm it's entered in for the following week
   10. Set a follow up meeting with the client for their next check-in
   11. Ask the client questions about their personal life.
`;

describe("standardsRegex chunker", () => {
  test("counts only lines that are actual CODE-NNN: headings", () => {
    expect(countStandardsHeadings(STANDARDS_FIXTURE)).toBe(3);
    expect(countStandardsHeadings("no codes here\njust prose about CS-010 inline")).toBe(0);
  });

  test("splits on the code scheme - one chunk per standard", () => {
    const chunks = chunkStandardsRegex(STANDARDS_FIXTURE, REF_CTX);
    expect(chunks.map((c) => c.metadata.standardCode)).toEqual(["CS-010", "CS-020", "CD-080"]);
  });

  test("prepends the category breadcrumb so a chunk retrieved alone says what it is", () => {
    const chunks = chunkStandardsRegex(STANDARDS_FIXTURE, REF_CTX);
    expect(chunks[0]!.text).toStartWith("Client Supervision (CS) — CS-010: Random Headcounts and Facility Walkthroughs");
    expect(chunks[0]!.metadata.categoryOrSection).toBe("Client Supervision (CS)");
  });

  test("carries the breadcrumb forward and switches on a new one", () => {
    const chunks = chunkStandardsRegex(STANDARDS_FIXTURE, REF_CTX);
    expect(chunks[1]!.metadata.categoryOrSection).toBe("Client Supervision (CS)");
    expect(chunks[2]!.metadata.categoryOrSection).toBe("Client Development (CD)");
    expect(chunks[2]!.text).toStartWith("Client Development (CD) — CD-080: Enhance Intrinsic Motivation");
  });

  test("keeps each standard's body with its own heading and nothing else's", () => {
    const chunks = chunkStandardsRegex(STANDARDS_FIXTURE, REF_CTX);
    expect(chunks[0]!.text).toContain("fourteen (14) random headcounts");
    expect(chunks[0]!.text).not.toContain("intrinsic motivation");
    expect(chunks[2]!.text).toContain("systematically enhancing intrinsic motivation");
    expect(chunks[2]!.text).not.toContain("headcounts");
  });

  test("marks standards chunks as non-summary reference material", () => {
    for (const chunk of chunkStandardsRegex(STANDARDS_FIXTURE, REF_CTX)) {
      expect(chunk.metadata.isSummary).toBe(false);
      expect(chunk.metadata.sourceType).toBe("reference_document");
    }
  });

  test("emits nothing for text with no standard headings", () => {
    expect(chunkStandardsRegex("Just a paragraph.\nAnd another.", REF_CTX)).toEqual([]);
  });
});

describe("wholeDoc chunker and the short-document route", () => {
  test("the check-in guidelines really are short enough to bypass splitting", () => {
    expect(wordCount(CHECKIN_GUIDELINES)).toBe(213);
    expect(wordCount(CHECKIN_GUIDELINES)).toBeLessThan(WHOLE_DOC_WORD_THRESHOLD);
  });

  test("routes to wholeDoc, not to a splitter", () => {
    expect(selectChunkStrategy(CHECKIN_GUIDELINES)).toBe("wholeDoc");
  });

  test("stays ONE chunk holding all 11 guideline items", () => {
    const chunks = chunkWholeDoc(CHECKIN_GUIDELINES, REF_CTX);
    expect(chunks).toHaveLength(1);

    const text = chunks[0]!.text;
    for (let item = 1; item <= 11; item++) {
      expect(text).toContain(`${item}. `);
    }
    // Spot-check the first and last item survived intact - "did the CM
    // follow *all* the guidelines" fails silently if either end is clipped.
    expect(text).toContain("Conﬁrm the client's address");
    expect(text).toContain("Ask the client questions about their personal life.");
  });

  test("trims surrounding whitespace but preserves the body", () => {
    const chunks = chunkWholeDoc("\n\n  hello world  \n\n", REF_CTX);
    expect(chunks[0]!.text).toBe("hello world");
  });

  test("passes the chunker context through to metadata", () => {
    const chunks = chunkWholeDoc("body", { sourceType: "transcript", clientId: "c-1", sessionDate: "2025-06-02" });
    expect(chunks[0]!.metadata).toEqual({
      sourceType: "transcript",
      clientId: "c-1",
      sessionDate: "2025-06-02",
      isSummary: false,
    });
  });
});

describe("selectChunkStrategy", () => {
  test("a long code-scheme document routes to standardsRegex", () => {
    // Padded past the 400-word wholeDoc threshold so the code-scheme branch
    // is the one under test.
    const padded = `${STANDARDS_FIXTURE}\n${"filler word ".repeat(250)}`;
    expect(wordCount(padded)).toBeGreaterThanOrEqual(WHOLE_DOC_WORD_THRESHOLD);
    expect(selectChunkStrategy(padded)).toBe("standardsRegex");
  });

  test("a long document with plain headings routes to namedSections", () => {
    const body = `${"body sentence here. ".repeat(50)}\n`;
    const doc = ["Timeline for Filing a Grievance", body, "Interviews and Investigation", body, "Report of Findings", body].join(
      "\n",
    );
    expect(selectChunkStrategy(doc)).toBe("namedSections");
  });

  test("a long unstructured document falls back to llmSegment", () => {
    const doc = `${"This is an ordinary sentence of running prose with no headings at all. ".repeat(40)}`;
    expect(wordCount(doc)).toBeGreaterThanOrEqual(WHOLE_DOC_WORD_THRESHOLD);
    expect(selectChunkStrategy(doc)).toBe("llmSegment");
  });
});
