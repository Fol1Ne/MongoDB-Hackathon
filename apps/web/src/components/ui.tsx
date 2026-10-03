import { Link } from "react-router-dom";

const PATHS = {
  move: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  rotate: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  plus: "M5 12h14M12 5v14",
  trash: "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M10 11v6M14 11v6",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  cube: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  copy: "M9 9h11v11H9zM5 15V6a2 2 0 0 1 2-2h9",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeoff: "M17.9 17.9A10.8 10.8 0 0 1 12 19C6 19 2 12 2 12a18.5 18.5 0 0 1 4.1-5M9.9 4.2A9.7 9.7 0 0 1 12 4c6 0 10 8 10 8a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  top: "M4 4h16v16H4zM4 12h16M12 4v16",
  iso: "M12 3l9 5v8l-9 5-9-5V8zM12 12l9-4M12 12L3 8M12 12v9",
  magnet: "M6 15V4h4v11a2 2 0 0 0 4 0V4h4v11a6 6 0 0 1-12 0zM6 8h4M14 8h4",
  camera: "M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  image: "M4 5h16v14H4zM4 15l4.5-4.5L13 15l2.5-2.5L20 17M15 9.5a1 1 0 1 0 0-.01",
  ruler: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  print: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 18l-6-6 6-6",
  x: "M6 6l12 12M18 6L6 18",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  review: "M9 11l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg className="i" viewBox="0 0 24 24" style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Brand({ title, meta }: { title: string; meta?: string }) {
  return (
    <Link to="/" className="brand" aria-label="Twin Studio home">
      <span className="logo"><Icon name="cube" /></span>
      <span className="brand-text">
        <b>{title}</b>
        {meta ? <span>{meta}</span> : null}
      </span>
    </Link>
  );
}

const STEPS = [
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "blueprint", label: "Blueprint" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export function Stepper({ active, envId }: { active: StepKey; envId?: string }) {
  const index = STEPS.findIndex((s) => s.key === active);
  const hrefFor = (key: StepKey) => (key === "create" ? "/" : envId ? (key === "edit" ? `/e/${envId}` : `/e/${envId}/blueprint`) : null);
  return (
    <nav className="stepper" aria-label="Demo steps">
      {STEPS.map((s, i) => {
        const state = i < index ? "done" : i === index ? "active" : "todo";
        const href = hrefFor(s.key);
        const body = (
          <>
            <i>{state === "done" ? "✓" : i + 1}</i>
            {s.label}
          </>
        );
        return (
          <span key={s.key} style={{ display: "contents" }}>
            {i > 0 ? <span className="step-sep" /> : null}
            {href && state !== "active" ? (
              <Link to={href} className={`step ${state}`}>{body}</Link>
            ) : (
              <span className={`step ${state}`} aria-current={state === "active" ? "step" : undefined}>{body}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PlanThumb({ svg, label }: { svg: string; label: string }) {
  return <div className="plan-thumb" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
