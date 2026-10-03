import { validateEnvironmentSpec, type EnvironmentSpec, type ValidationError } from "../contract";

export type Issue = ValidationError;
export interface ObjectIssues {
  errors: Issue[];
  warnings: Issue[];
}
export interface Analysis {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  byId: ReadonlyMap<string, ObjectIssues>;
}

export const EMPTY_ANALYSIS: Analysis = { valid: true, errors: [], warnings: [], byId: new Map() };

const OWN_INDEX = /^objects\[(\d+)\]/;
const OTHER_INDEX = /\(objects\[(\d+)\]\)/;

export function analyze(spec: EnvironmentSpec): Analysis {
  const result = validateEnvironmentSpec(spec);
  const byId = new Map<string, ObjectIssues>();
  const slot = (id: string) => {
    let s = byId.get(id);
    if (!s) byId.set(id, (s = { errors: [], warnings: [] }));
    return s;
  };
  const idAt = (index: string | undefined) => (index === undefined ? undefined : spec.objects[Number(index)]?.id);
  const put = (kind: keyof ObjectIssues, issue: Issue) => {
    const own = idAt(OWN_INDEX.exec(issue.path)?.[1]);
    if (own) slot(own)[kind].push(issue);
    const other = idAt(OTHER_INDEX.exec(issue.message)?.[1]);
    if (other && own) slot(other)[kind].push({ ...issue, message: `Overlaps ${own}` });
  };
  result.errors.forEach((e) => put("errors", e));
  result.warnings.forEach((w) => put("warnings", w));
  return { valid: result.valid, errors: result.errors, warnings: result.warnings, byId };
}
