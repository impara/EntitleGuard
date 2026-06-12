import { describe, expect, it } from "vitest";
import { parseCsvText } from "../csv";

describe("parseCsvText", () => {
  it("parses a comma-delimited CSV with headers", () => {
    const result = parseCsvText(
      "email,status\na@example.com,active\nb@example.com,canceled\n",
      "test.csv",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.headers).toEqual(["email", "status"]);
    expect(result.data.rowCount).toBe(2);
    expect(result.data.rows[0].email).toBe("a@example.com");
    expect(result.data.delimiter).toBe(",");
  });

  it("handles semicolon delimiters", () => {
    const result = parseCsvText(
      "email;status\na@example.com;active\n",
      "semi.csv",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delimiter).toBe(";");
    expect(result.data.rows[0].status).toBe("active");
  });

  it("handles tab delimiters", () => {
    const result = parseCsvText("email\tstatus\na@example.com\tactive\n", "tab.csv");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows[0].email).toBe("a@example.com");
  });

  it("strips a UTF-8 BOM", () => {
    const result = parseCsvText("\uFEFFemail,status\na@example.com,active\n", "bom.csv");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.headers[0]).toBe("email");
  });

  it("rejects empty files", () => {
    const result = parseCsvText("   \n  ", "empty.csv");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EMPTY_FILE");
  });

  it("rejects header-only files", () => {
    const result = parseCsvText("email,status\n", "headers-only.csv");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_ROWS");
  });

  it("warns on ragged rows instead of failing", () => {
    const result = parseCsvText(
      "email,status,plan\na@example.com,active\nb@example.com,canceled,pro\n",
      "ragged.csv",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.warnings.length).toBeGreaterThan(0);
    expect(result.data.rowCount).toBe(2);
  });

  it("skips blank lines", () => {
    const result = parseCsvText(
      "email,status\na@example.com,active\n\n\nb@example.com,canceled\n",
      "blanks.csv",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rowCount).toBe(2);
  });
});
