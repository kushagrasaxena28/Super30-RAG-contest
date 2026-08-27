import { describe, expect, test } from "bun:test";
import { detectType, countWords } from "../../src/ingestion/extract.js";
import { IngestionError } from "../../src/ingestion/errors.js";

/**
 * Magic-byte validation (plan/09-hardening.md #2). An extension is
 * trivially spoofed, so a `.pdf` whose bytes are not `%PDF` must be
 * rejected - the reviewer's "renamed non-PDF -> 415" check in plan/10.
 */

const PDF_BYTES = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n", "latin1");
const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("rest of a docx")]);
const TEXT_BYTES = Buffer.from("Plain text about a check-in meeting.", "utf8");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const EMPTY = Buffer.alloc(0);

function expectRejected(name: string, buf: Buffer) {
  let thrown: unknown;
  try {
    detectType(name, buf);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(IngestionError);
  const err = thrown as IngestionError;
  expect(err.httpStatus).toBe(415);
  expect(err.retryable).toBe(false);
  // The message must name the file but must not leak a filesystem path.
  expect(err.message).toContain(name.split("/").pop()!);
  return err;
}

describe("detectType - genuine files", () => {
  test("accepts a real PDF", () => {
    expect(detectType("nathan-06-02.pdf", PDF_BYTES)).toBe("pdf");
  });

  test("accepts a real docx (PK zip header)", () => {
    expect(detectType("notes.docx", ZIP_BYTES)).toBe("docx");
  });

  test("accepts .txt and .md as text", () => {
    expect(detectType("notes.txt", TEXT_BYTES)).toBe("txt");
    expect(detectType("notes.md", TEXT_BYTES)).toBe("txt");
  });

  test("is case-insensitive about the extension", () => {
    expect(detectType("NATHAN-06-02.PDF", PDF_BYTES)).toBe("pdf");
    expect(detectType("Notes.DOCX", ZIP_BYTES)).toBe("docx");
  });
});

describe("detectType - spoofed extensions are rejected", () => {
  test("a PNG renamed to .pdf is rejected 415", () => {
    expectRejected("actually-an-image.pdf", PNG_BYTES);
  });

  test("plain text renamed to .pdf is rejected 415", () => {
    expectRejected("not-really.pdf", TEXT_BYTES);
  });

  test("a zip/docx renamed to .pdf is rejected 415", () => {
    expectRejected("disguised.pdf", ZIP_BYTES);
  });

  test("an empty file named .pdf is rejected 415", () => {
    expectRejected("empty.pdf", EMPTY);
  });

  test("a PDF renamed to .txt is rejected - the bytes are not text", () => {
    expectRejected("disguised.txt", PDF_BYTES);
  });

  test("a PDF renamed to .docx is rejected - no PK header", () => {
    expectRejected("disguised.docx", PDF_BYTES);
  });

  test("plain text renamed to .docx is rejected", () => {
    expectRejected("disguised.docx", TEXT_BYTES);
  });

  test("an unsupported extension is rejected even with valid PDF bytes", () => {
    expectRejected("report.exe", PDF_BYTES);
    expectRejected("noextension", PDF_BYTES);
  });

  test("%PDF must be at offset 0, not merely present", () => {
    expectRejected("late-header.pdf", Buffer.concat([Buffer.from("junk"), PDF_BYTES]));
  });
});

describe("countWords", () => {
  test("counts whitespace-separated tokens", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  padded \n across \t lines  ")).toBe(3);
  });

  test("empty and whitespace-only extract to zero - the scanned-PDF signal", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\n \t ")).toBe(0);
  });
});
