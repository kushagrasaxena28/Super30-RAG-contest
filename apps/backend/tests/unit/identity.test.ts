import { describe, expect, test } from "bun:test";
import { parseIdentityFromFilename } from "../../src/ingestion/identity.js";

/**
 * The bundled dataset's filenames carry a month and day but NO year, and
 * src/ingestion/identity.ts defaults them to 2025 (DEFAULT_YEAR). These
 * tests pin that convention deliberately: if the default year ever moves,
 * every `sessionDate` in the corpus moves with it and "Nathan's last
 * meeting" starts resolving to the wrong transcript.
 */
describe("parseIdentityFromFilename", () => {
  test("parses the real bundled transcript filenames", () => {
    // The five files in docs/transcriptions_for_test/.
    expect(parseIdentityFromFilename("nathan-04-14.pdf")).toEqual({ clientName: "Nathan", sessionDate: "2025-04-14" });
    expect(parseIdentityFromFilename("nathan-05-19.pdf")).toEqual({ clientName: "Nathan", sessionDate: "2025-05-19" });
    expect(parseIdentityFromFilename("nathan-06-02.pdf")).toEqual({ clientName: "Nathan", sessionDate: "2025-06-02" });
    expect(parseIdentityFromFilename("robert-05-07.pdf")).toEqual({ clientName: "Robert", sessionDate: "2025-05-07" });
    // Note the missing zero-pad on the month - the dataset is inconsistent.
    expect(parseIdentityFromFilename("robert-5-21.pdf")).toEqual({ clientName: "Robert", sessionDate: "2025-05-21" });
  });

  test("nathan-06-02 is the latest Nathan session - the MAX(sessionDate) target", () => {
    const dates = ["nathan-04-14.pdf", "nathan-05-19.pdf", "nathan-06-02.pdf"].map(
      (f) => parseIdentityFromFilename(f).sessionDate!,
    );
    expect([...dates].sort().at(-1)).toBe("2025-06-02");
  });

  test("zero-pads month and day in the emitted ISO date", () => {
    expect(parseIdentityFromFilename("robert-5-7.pdf").sessionDate).toBe("2025-05-07");
  });

  test("capitalizes the client name regardless of filename casing", () => {
    expect(parseIdentityFromFilename("NATHAN-06-02.pdf").clientName).toBe("Nathan");
    expect(parseIdentityFromFilename("nAtHaN-06-02.pdf").clientName).toBe("Nathan");
  });

  test("works for any extension, and for no extension", () => {
    expect(parseIdentityFromFilename("nathan-06-02.txt").sessionDate).toBe("2025-06-02");
    expect(parseIdentityFromFilename("nathan-06-02.docx").sessionDate).toBe("2025-06-02");
    expect(parseIdentityFromFilename("nathan-06-02").sessionDate).toBe("2025-06-02");
  });

  test("ignores trailing filename noise after the date", () => {
    expect(parseIdentityFromFilename("nathan-06-02-final-v2.pdf")).toEqual({
      clientName: "Nathan",
      sessionDate: "2025-06-02",
    });
  });

  test("keeps the name but drops an impossible date rather than fabricating one", () => {
    expect(parseIdentityFromFilename("nathan-13-02.pdf")).toEqual({ clientName: "Nathan", sessionDate: null });
    expect(parseIdentityFromFilename("nathan-06-40.pdf")).toEqual({ clientName: "Nathan", sessionDate: null });
    expect(parseIdentityFromFilename("nathan-00-02.pdf")).toEqual({ clientName: "Nathan", sessionDate: null });
  });

  test("returns nulls for filenames that do not follow the convention", () => {
    // Uploaded files are not expected to match; the caller falls back to
    // content-derived identity.
    for (const name of [
      "check-in-guidelines.pdf",
      "grievance-and-appeal.pdf",
      "8 Principles of Effective Intervention.pdf",
      "2022 Colorado Community Corrections Standards copy.pdf",
      "internal-programming.pdf",
    ]) {
      expect(parseIdentityFromFilename(name)).toEqual({ clientName: null, sessionDate: null });
    }
  });

  test("strips any directory component before matching", () => {
    expect(parseIdentityFromFilename("/data/docs/transcriptions_for_test/nathan-06-02.pdf")).toEqual({
      clientName: "Nathan",
      sessionDate: "2025-06-02",
    });
  });
});
