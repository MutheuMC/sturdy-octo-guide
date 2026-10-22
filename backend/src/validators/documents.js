const { z } = require("zod");
const yauzl = require("yauzl");

const title = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !/[<>\x00-\x1f]/.test(value),
    "Use plain text without control characters",
  );

const linkSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS URL without credentials");

function validateOffice(buffer, kind) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("Invalid Office document"));

      let count = 0;
      let total = 0;
      let content = false;
      let main = false;

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
        ) {
          main = true;
        }
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

module.exports = { linkSchema, title, validateOffice };
