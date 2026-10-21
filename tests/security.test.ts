import { test } from "node:test";
import assert from "node:assert/strict";
import { title, linkSchema, validateOffice } from "../server/security";
test("document links reject executable schemes and embedded credentials", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "http://example.com",
    "https://user:pass@example.com",
  ])
    assert.equal(linkSchema.safeParse(value).success, false);
  assert.equal(
    linkSchema.parse("https://example.com/slides"),
    "https://example.com/slides",
  );
});
test("titles reject HTML and control characters while preserving normal names", () => {
  for (const value of [
    "",
    "<script>alert(1)</script>",
    "hello\u0000world",
    "a".repeat(121),
  ])
    assert.equal(title.safeParse(value).success, false);
  assert.equal(title.parse("  Quarterly strategy  "), "Quarterly strategy");
});
test("renaming arbitrary bytes to an Office extension does not pass validation", async () => {
  await assert.rejects(validateOffice(Buffer.from("not a powerpoint"), "PPTX"));
  await assert.rejects(validateOffice(Buffer.from("%PDF-1.4"), "DOCX"));
});

test("accepts PPTX structure", async () => {
  await validateOffice(
    Buffer.from(
      "UEsDBBQAAAAIAEqDVV3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgASoNVXdltI+kRAAAADwAAABQAAABwcHQvcHJlc2VudGF0aW9uLnhtbLMpKEotTs0rSSzJzM/TtwMAUEsBAhQDFAAAAAgASoNVXcccFzwKAAAACAAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABKg1Vd2W0j6REAAAAPAAAAFAAAAAAAAAAAAAAAgAE7AAAAcHB0L3ByZXNlbnRhdGlvbi54bWxQSwUGAAAAAAIAAgCDAAAAfgAAAAAA",
      "base64",
    ),
    "PPTX",
  );
});

test("accepts DOCX structure", async () => {
  await validateOffice(
    Buffer.from(
      "UEsDBBQAAAAIAEqDVV3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgASoNVXV9b0UwNAAAACwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLNJyU8uzU3NK9G3AwBQSwECFAMUAAAACABKg1VdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAEqDVV1fW9FMDQAAAAsAAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAB3AAAAAAA=",
      "base64",
    ),
    "DOCX",
  );
});

test("rejects macro-containing archive", async () => {
  await assert.rejects(
    validateOffice(
      Buffer.from(
        "UEsDBBQAAAAIAEqDVV3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgASoNVXdltI+kRAAAADwAAABQAAABwcHQvcHJlc2VudGF0aW9uLnhtbLMpKEotTs0rSSzJzM/TtwMAUEsDBBQAAAAIAEqDVV1Dxo+uBwAAAAUAAAASAAAAcHB0L3ZiYVByb2plY3QuYmluy01MLsoHAFBLAQIUAxQAAAAIAEqDVV3HHBc8CgAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgASoNVXdltI+kRAAAADwAAABQAAAAAAAAAAAAAAIABOwAAAHBwdC9wcmVzZW50YXRpb24ueG1sUEsBAhQDFAAAAAgASoNVXUPGj64HAAAABQAAABIAAAAAAAAAAAAAAIABfgAAAHBwdC92YmFQcm9qZWN0LmJpblBLBQYAAAAAAwADAMMAAAC1AAAAAAA=",
        "base64",
      ),
      "PPTX",
    ),
  );
});

test("rejects mismatched Office extension", async () => {
  await assert.rejects(
    validateOffice(
      Buffer.from(
        "UEsDBBQAAAAIAEqDVV3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgASoNVXV9b0UwNAAAACwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLNJyU8uzU3NK9G3AwBQSwECFAMUAAAACABKg1VdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAEqDVV1fW9FMDQAAAAsAAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAB3AAAAAAA=",
        "base64",
      ),
      "PPTX",
    ),
  );
});
