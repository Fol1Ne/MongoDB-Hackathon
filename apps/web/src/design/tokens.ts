export const CATEGORY_HEX = {
  vehicle: "#ed7940",
  robotics: "#4c80cd",
  safety: "#c13c3b",
  logistics: "#eccb61",
  factory: "#32a5a2",
  furniture: "#d1ade8",
  storage: "#bea692",
  structure: "#dbd7cf",
} as const;

export type Category = keyof typeof CATEGORY_HEX;

export const CATEGORY_ORDER: readonly Category[] = ["storage", "logistics", "factory", "furniture", "robotics", "vehicle", "safety", "structure"];

export const CATEGORY_LABEL: Record<Category, string> = {
  vehicle: "Vehicles",
  robotics: "Robotics",
  safety: "Safety",
  logistics: "Logistics",
  factory: "Factory",
  furniture: "Furniture",
  storage: "Storage",
  structure: "Structure",
};

export const COLORS = {
  page: "#ece6d9",
  stage: "#f5f1e8",
  floor: "#f0eadd",
  floorMinor: "#e2d9c4",
  floorMajor: "#cfc3a6",
  slab: "#e7dfcd",
  ink: "#2a251d",
  muted: "#8c8372",
  accent: "#d8623a",
  accentFill: "#c4512b",
  ok: "#3f8f6b",
  warn: "#b9791a",
  bad: "#c13c3b",
  lowConfidence: "#d9a13a",
  blueprintInk: "#1f4e8c",
  blueprintPaper: "#ffffff",
  gizmoX: "#d8623a",
  gizmoY: "#3f8f6b",
  gizmoZ: "#4a6fd0",
} as const;

export const MOTION = {
  glideRate: 14,
  tintRate: 16,
  buildDuration: 0.7,
  buildSpread: 1.8,
  introFly: 2.4,
} as const;

export const LOW_CONFIDENCE = 0.5;
