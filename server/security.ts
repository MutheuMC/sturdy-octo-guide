import { z } from "zod";
import yauzl from "yauzl";
export const title = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (v) => !/[<>\x00-\x1f]/.test(v),
    "Use plain text without control characters",
  );
export const linkSchema = z
  .string()
  .max(2048)
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Use an HTTPS URL without credentials");
export function validateOffice(buffer: Buffer, kind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new Error("Invalid Office document"));
      let count = 0,
        total = 0,
        content = false,
        main = false;
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        count++;
        total += entry.uncompressedSize;
        if (
          count > 10000 ||
          total > 250 * 1024 * 1024 ||
          /(^|\/)\.\.(\/|$)|^\//.test(entry.fileName) ||
          /vbaProject|activeX|embeddings\//i.test(entry.fileName) ||
          entry.generalPurposeBitFlag & 1
        ) {
          zip.close();
          return reject(
            new Error("Unsafe, encrypted, or oversized Office archive"),
          );
        }
        if (entry.fileName === "[Content_Types].xml") content = true;
        if (
          entry.fileName ===
          (kind === "PPTX" ? "ppt/presentation.xml" : "word/document.xml")
        )
          main = true;
        zip.readEntry();
      });
      zip.on("end", () =>
        content && main
          ? resolve()
          : reject(new Error("File contents do not match its extension")),
      );
      zip.readEntry();
    });
  });
}
