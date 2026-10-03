export const CATEGORY_HEX = {
  storage: "#5ac8fa",
  logistics: "#ffd166",
  factory: "#6ee7a8",
  furniture: "#a5b5d2",
  robotics: "#b794f6",
  vehicle: "#ffa94d",
  safety: "#ff7b9c",
  structure: "#70819f",
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
  stage: "#0a1020",
  floor: "#0d1932",
  floorOutside: "#070c18",
  gridMinor: "#21406c",
  gridMajor: "#3f7fc0",
  border: "#8ccfff",
  route: "#ffd166",
  ink: "#d6e4ff",
  muted: "#7388b0",
  accent: "#5ac8fa",
  warn: "#ffc857",
  bad: "#ff6b81",
  lightSky: "#d6e4ff",
  lightGround: "#1b2b4b",
  lightFill: "#8ccfff",
} as const;

export const MOTION = {
  glideRate: 14,
  tintRate: 16,
  buildDuration: 0.7,
  buildSpread: 1.8,
  introFly: 2.4,
} as const;

export const LOW_CONFIDENCE = 0.5;
