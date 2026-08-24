import assert from "node:assert/strict";
import test from "node:test";

import { makeLookupOutput, officialGuide } from "../src/service.js";

test("makeLookupOutput exposes ambiguity instead of selecting the first candidate", () => {
  const output = makeLookupOutput({
    found: true,
    ambiguous: true,
    query: { department: "CANELONES", padron: "1" },
    matches: [
      { regime: "CO", department: "CANELONES", locality: "CANELONES", padron: "1", snapshot: "2026-08" },
      { regime: "CO", department: "CANELONES", locality: "JOANICO", padron: "1", snapshot: "2026-08" },
    ],
  });

  assert.equal(output.structuredContent.ambiguous, true);
  assert.equal(output.structuredContent.matches.length, 2);
  assert.match(output.content[0].text, /2 candidatos/i);
  assert.match(output.content[0].text, /localidad/i);
});

test("officialGuide directs legal-value requests to the official cadastral certificate", () => {
  const guide = officialGuide("valor_legal");
  assert.match(guide.text, /valor legal/i);
  assert.equal(guide.links[0].url, "https://www.gub.uy/tramites/cedula-catastral");
});
