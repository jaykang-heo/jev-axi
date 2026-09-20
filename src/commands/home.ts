import { keyStatus } from "../key.js";
import { DEFAULT_MODEL, JEV_BASE } from "../request.js";
import { renderHelp, renderOutput } from "../toon.js";

function keyLine(): string {
  const s = keyStatus();
  switch (s.kind) {
    case "environment":
      return "key: present (environment)";
    case "config":
      return "key: present (~/.config/jev-axi/env)";
    case "absent":
      return "key: absent";
    case "refused":
      return `key: refused (${s.detail})`;
  }
}

export function homeCommand(): string {
  return renderOutput([
    keyLine(),
    `model: ${DEFAULT_MODEL} (pinned)`,
    `endpoint: ${JEV_BASE}/v1/systemone`,
    renderHelp([
      'jev-axi choice --state <file> --option a="<criterion>" --option b="<criterion>" --none',
      'jev-axi noul --state <file> --ask "<statement that is true or false of the state>"',
      "jev-axi score --state <file> --rubric <file>",
      "jev-axi ask --state <file> --questions-file <json>",
      "jev-axi --help",
    ]),
  ]);
}
