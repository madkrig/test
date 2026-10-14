import { AUTOMATED_KINDS, KIND_LABELS, type StepKind, type WorkflowDefinition } from './types';

/**
 * Lagdelt layout fra venstre mod højre, som i forløbsbyggerens diagram:
 * - kolonne = længste vej fra start (tilbagekanter tæller ikke med),
 * - række 0 = hovedsporet (første rute fra hvert trin), forgreninger nedenunder,
 * - fremadrettede ruter tegnes som lige linjer eller S-kurver,
 * - tilbagekanter ("returneret", "prøv igen") tegnes som afrundede løkker over
 *   hovedsporet eller i mellemrummet under kildens række.
 * Rene funktioner uden DOM, så layoutet kan testes og renderes på serveren.
 */
export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  endWidth: number;
  endHeight: number;
  rankGap: number;
  rowGap: number;
  laneGap: number;
  aboveOffset: number;
  margin: number;
  startGap: number;
  cornerRadius: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 224,
  nodeHeight: 60,
  endWidth: 140,
  endHeight: 44,
  rankGap: 104,
  rowGap: 56,
  laneGap: 16,
  aboveOffset: 30,
  margin: 24,
  startGap: 26,
  cornerRadius: 10,
};

export type NodeKind = StepKind | 'end';

export interface LayoutNode {
  key: string;
  /** Nummer i trin-tabellen (trin i definitionens rækkefølge, derefter sluttilstande). */
  index: number;
  title: string;
  subtitle: string;
  kind: NodeKind;
  automated: boolean;
  tone?: 'ok' | 'failed';
  badge?: 'start' | 'exception';
  rank: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point { x: number; y: number }
export type EdgeShape = 'straight' | 'curve' | 'loop';

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  outcome: string;
  shape: EdgeShape;
  /** SVG-sti. */
  path: string;
  /** Polylinje-tilnærmelse af stien (til test og kollisionskontrol). */
  points: Point[];
  /** Midten af etikettens pille. */
  label: Point;
}

export interface WorkflowLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Startprikkens midte. */
  start: Point;
}

interface Rect { x: number; y: number; width: number; height: number }
type Command = ['M' | 'L', number, number] | ['Q', number, number, number, number] | ['C', number, number, number, number, number, number];
interface RawEdge { id: string; from: string; to: string; outcome: string }

/** Anslået størrelse på en etiket (12px tekst + polstring). Bruges til plads og test. */
export function labelSize(outcome: string): { width: number; height: number } {
  return { width: Math.round(outcome.length * 6.8) + 18, height: 20 };
}

export function layoutWorkflow(def: WorkflowDefinition, opts: LayoutOptions = DEFAULT_LAYOUT): WorkflowLayout {
  const keys = [...def.steps.map((s) => s.key), ...def.ends.map((e) => e.key)];
  const known = new Set(keys);
  if (known.size !== keys.length) throw new Error(`Forløbet "${def.key}" har dublerede nøgler.`);
  if (!known.has(def.start)) throw new Error(`Forløbet "${def.key}" starter i ukendt trin "${def.start}".`);
  const edges: RawEdge[] = def.steps.flatMap((s) => s.routes.map((r) => {
    if (!known.has(r.to)) throw new Error(`Ruten "${r.outcome}" fra "${s.key}" peger på ukendt trin "${r.to}".`);
    return { id: `${s.key}:${r.outcome}:${r.to}`, from: s.key, to: r.to, outcome: r.outcome };
  }));
  const out = new Map<string, RawEdge[]>(keys.map((k) => [k, []]));
  for (const e of edges) out.get(e.from)!.push(e);

  // 1) Tilbagekanter: kanter til et trin, der stadig er åbent i en dybde-først-gennemgang fra start.
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (u: string) => {
    state.set(u, 'open');
    for (const e of out.get(u)!) {
      const s = state.get(e.to);
      if (s === 'open') back.add(e.id);
      else if (!s) visit(e.to);
    }
    state.set(u, 'done');
  };
  visit(def.start);
  for (const k of keys) if (!state.has(k)) visit(k);
  const forward = edges.filter((e) => !back.has(e.id));

  // 2) Kolonne = længste vej ad fremadrettede kanter (topologisk rækkefølge).
  const rank = new Map<string, number>(keys.map((k) => [k, 0]));
  const indegree = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const e of forward) indegree.set(e.to, indegree.get(e.to)! + 1);
  const queue = keys.filter((k) => indegree.get(k) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of forward) {
      if (e.from !== u) continue;
      rank.set(e.to, Math.max(rank.get(e.to)!, rank.get(u)! + 1));
      indegree.set(e.to, indegree.get(e.to)! - 1);
      if (indegree.get(e.to) === 0) queue.push(e.to);
    }
  }

  // 3) Rækker. Hovedsporet følger den første fremadrettede rute fra start.
  const spine = [def.start];
  for (let u = def.start; ;) {
    const next = out.get(u)!.find((e) => !back.has(e.id) && !spine.includes(e.to));
    if (!next) break;
    spine.push(next.to);
    u = next.to;
  }
  const onSpine = new Set(spine);
  const row = new Map<string, number>();
  const taken = new Set<string>();
  const reserved = new Set<string>();
  const cell = (r: number, w: number) => `${r}:${w}`;
  for (const k of spine) {
    row.set(k, 0);
    taken.add(cell(rank.get(k)!, 0));
  }
  const order: string[] = [];
  const seen = new Set([def.start]);
  for (const bfs = [def.start]; bfs.length;) {
    const u = bfs.shift()!;
    order.push(u);
    for (const e of out.get(u)!) if (!seen.has(e.to)) { seen.add(e.to); bfs.push(e.to); }
  }
  order.push(...keys.filter((k) => !seen.has(k)));
  const hints = new Map(def.steps.flatMap((s) => (s.row === undefined ? [] : [[s.key, s.row] as const])));
  const place = (k: string) => {
    const col = rank.get(k)!;
    const hint = hints.get(k);
    if (hint !== undefined) {
      if (taken.has(cell(col, hint))) throw new Error(`Trinnet "${k}" kan ikke stå i række ${hint}: pladsen er optaget.`);
      row.set(k, hint);
      taken.add(cell(col, hint));
      return;
    }
    const preds = forward.filter((e) => e.to === k && row.has(e.from)).map((e) => row.get(e.from)!);
    let r = Math.max(1, preds.length ? Math.min(...preds) : 1);
    while (taken.has(cell(col, r)) || reserved.has(cell(col, r))) r++;
    row.set(k, r);
    taken.add(cell(col, r));
  };
  // Trin, der vender tilbage til hovedsporet (undtagelser, genforsøg), placeres først og tættest på.
  const rest = order.filter((k) => !row.has(k));
  const rejoins = (k: string) => out.get(k)!.some((e) => onSpine.has(e.to));
  rest.filter(rejoins).forEach(place);
  // Deres tilbagekanter går op under målet; hold den lodrette korridor fri for andre trin.
  for (const e of edges) {
    if (!back.has(e.id) || !row.has(e.from) || !row.has(e.to)) continue;
    for (let r = row.get(e.to)! + 1; r <= row.get(e.from)!; r++) reserved.add(cell(rank.get(e.to)!, r));
  }
  rest.filter((k) => !rejoins(k)).forEach(place);

  // 4) Koordinater (før forskydning; række 0's top er y = 0).
  const colWidth = opts.nodeWidth + opts.rankGap;
  const rowHeight = opts.nodeHeight + opts.rowGap;
  const steps = new Map(def.steps.map((s) => [s.key, s]));
  const ends = new Map(def.ends.map((e) => [e.key, e]));
  const nodes: LayoutNode[] = keys.map((key, i) => {
    const step = steps.get(key);
    const end = ends.get(key);
    const r = row.get(key)!;
    const height = end ? opts.endHeight : opts.nodeHeight;
    return {
      key,
      index: i + 1,
      title: step?.title ?? end!.title,
      subtitle: step ? step.who ?? KIND_LABELS[step.kind] : '',
      kind: step?.kind ?? 'end',
      automated: !!step && AUTOMATED_KINDS.has(step.kind),
      ...(end ? { tone: end.tone } : {}),
      ...(step?.badge ? { badge: step.badge } : {}),
      rank: rank.get(key)!,
      row: r,
      x: rank.get(key)! * colWidth,
      y: r * rowHeight + (opts.nodeHeight - height) / 2,
      width: end ? opts.endWidth : opts.nodeWidth,
      height,
    };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const startNode = byKey.get(def.start)!;
  let start: Point = { x: startNode.x - opts.startGap, y: startNode.y + startNode.height / 2 };

  // 5) Kanter.
  const rowBottom = (r: number) => r * rowHeight + opts.nodeHeight;
  const gapLanes = new Map<number, number>();
  let aboveLanes = 0;
  const routed: { edge: RawEdge; shape: EdgeShape; commands: Command[]; points: Point[]; label: Point }[] = [];
  const gapY = (r: number) => rowBottom(r) + opts.rowGap / 2 + (gapLanes.get(r) ?? 0) * opts.laneGap;
  for (const e of edges) {
    const s = byKey.get(e.from)!;
    const t = byKey.get(e.to)!;
    if (!back.has(e.id)) {
      const sx = s.x + s.width, sy = s.y + s.height / 2, tx = t.x, ty = t.y + t.height / 2;
      const others = nodes.filter((n) => n.key !== s.key && n.key !== t.key);
      let direct: Omit<(typeof routed)[number], 'edge'>;
      if (Math.abs(sy - ty) < 0.5) {
        direct = { shape: 'straight', commands: [['M', sx, sy], ['L', tx, ty]], points: [{ x: sx, y: sy }, { x: tx, y: ty }], label: { x: (sx + tx) / 2, y: sy } };
      } else {
        // S-kurve i mellemrummet lige efter kilden, derefter vandret ind i målet.
        const c = Math.min(tx, sx + opts.rankGap);
        const mx = (sx + c) / 2;
        const commands: Command[] = [['M', sx, sy], ['C', mx, sy, mx, ty, c, ty]];
        const points = sampleCubic({ x: sx, y: sy }, { x: mx, y: sy }, { x: mx, y: ty }, { x: c, y: ty });
        if (c < tx) { commands.push(['L', tx, ty]); points.push({ x: tx, y: ty }); }
        direct = { shape: 'curve', commands, points, label: { x: mx, y: (sy + ty) / 2 } };
      }
      if (!hitsNodes(direct.points, others) || tx - sx < 2 * opts.rankGap) {
        routed.push({ edge: e, ...direct });
        continue;
      }
      // Omvej: ned i mellemrummet under rækken, forbi trinene og op i målet.
      const laneRow = Math.min(s.row, t.row);
      const y = gapY(laneRow);
      const g = Math.min(opts.rankGap, (tx - sx) / 2);
      const commands: Command[] = [
        ['M', sx, sy], ['C', sx + g / 2, sy, sx + g / 2, y, sx + g, y],
        ['L', tx - g, y], ['C', tx - g / 2, y, tx - g / 2, ty, tx, ty],
      ];
      const points = [
        ...sampleCubic({ x: sx, y: sy }, { x: sx + g / 2, y: sy }, { x: sx + g / 2, y }, { x: sx + g, y }),
        ...sampleCubic({ x: tx - g, y }, { x: tx - g / 2, y }, { x: tx - g / 2, y: ty }, { x: tx, y: ty }),
      ];
      if (hitsNodes(points, others)) {
        routed.push({ edge: e, ...direct });
        continue;
      }
      gapLanes.set(laneRow, (gapLanes.get(laneRow) ?? 0) + 1);
      routed.push({ edge: e, shape: 'curve', commands, points, label: { x: (sx + tx) / 2, y } });
      continue;
    }
    // Tilbagekant: vælg den første løkke, der ikke går gennem andre trin.
    const others = nodes.filter((n) => n.key !== s.key && n.key !== t.key);
    const scx = s.x + s.width / 2, tcx = t.x + t.width / 2;
    const above = (): Point[] => {
      const y = -opts.aboveOffset - aboveLanes * opts.laneGap;
      return [{ x: scx, y: s.y }, { x: scx, y }, { x: tcx, y }, { x: tcx, y: t.y }];
    };
    const lowest = Math.max(s.row, t.row);
    const below = (): Point[] => {
      const y = gapY(lowest);
      return [{ x: scx, y: s.y + s.height }, { x: scx, y }, { x: tcx, y }, { x: tcx, y: t.y + t.height }];
    };
    const candidates = s.row === 0 && t.row === 0 ? [above, below] : [below, above];
    const routes = candidates.map((make) => ({ make, points: make() }));
    const chosen = routes.find((c) => !hitsNodes(c.points, others)) ?? routes[0]!;
    if (chosen.make === above) aboveLanes++;
    else gapLanes.set(lowest, (gapLanes.get(lowest) ?? 0) + 1);
    const p = chosen.points;
    routed.push({ edge: e, shape: 'loop', commands: roundedCommands(p, opts.cornerRadius), points: p, label: { x: (p[1]!.x + p[2]!.x) / 2, y: p[1]!.y } });
  }

  // 6) Forskyd alt, så tegningen starter ved margenen.
  const xs: number[] = [start.x - 6];
  const ys: number[] = [start.y - 6];
  const maxX: number[] = [];
  const maxY: number[] = [];
  for (const n of nodes) { xs.push(n.x); ys.push(n.y); maxX.push(n.x + n.width); maxY.push(n.y + n.height); }
  for (const r of routed) {
    for (const pt of r.points) { xs.push(pt.x); ys.push(pt.y); maxX.push(pt.x); maxY.push(pt.y); }
    const size = labelSize(r.edge.outcome);
    xs.push(r.label.x - size.width / 2); ys.push(r.label.y - size.height / 2);
    maxX.push(r.label.x + size.width / 2); maxY.push(r.label.y + size.height / 2);
  }
  const dx = opts.margin - Math.min(...xs);
  const dy = opts.margin - Math.min(...ys);
  const move = (pt: Point): Point => ({ x: pt.x + dx, y: pt.y + dy });
  start = move(start);
  return {
    nodes: nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: routed.map((r) => ({
      id: r.edge.id,
      from: r.edge.from,
      to: r.edge.to,
      outcome: r.edge.outcome,
      shape: r.shape,
      path: toPath(r.commands, dx, dy),
      points: r.points.map(move),
      label: move(r.label),
    })),
    width: Math.ceil(Math.max(...maxX) + dx + opts.margin),
    height: Math.ceil(Math.max(...maxY) + dy + opts.margin),
    start,
  };
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return pts;
}

/** Retvinklet polylinje med afrundede hjørner. */
function roundedCommands(points: Point[], radius: number): Command[] {
  const cmds: Command[] = [['M', points[0]!.x, points[0]!.y]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, corner = points[i]!, next = points[i + 1]!;
    const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (r < 0.5) { cmds.push(['L', corner.x, corner.y]); continue; }
    const a = { x: corner.x - ((corner.x - prev.x) / lenIn) * r, y: corner.y - ((corner.y - prev.y) / lenIn) * r };
    const b = { x: corner.x + ((next.x - corner.x) / lenOut) * r, y: corner.y + ((next.y - corner.y) / lenOut) * r };
    cmds.push(['L', a.x, a.y], ['Q', corner.x, corner.y, b.x, b.y]);
  }
  const last = points[points.length - 1]!;
  cmds.push(['L', last.x, last.y]);
  return cmds;
}

function toPath(commands: Command[], dx: number, dy: number): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  return commands.map(([op, ...v]) => op + v.map((value, i) => n(value + (i % 2 === 0 ? dx : dy))).join(' ')).join('');
}

function inside(pt: Point, r: Rect, pad = 1): boolean {
  return pt.x > r.x + pad && pt.x < r.x + r.width - pad && pt.y > r.y + pad && pt.y < r.y + r.height - pad;
}

/** Går polylinjen gennem et af trinene? Prøver punkter med højst 4px mellemrum. */
function hitsNodes(points: Point[], rects: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let k = 0; k <= steps; k++) {
      const pt = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      if (rects.some((r) => inside(pt, r))) return true;
    }
  }
  return false;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Kontrol til test: kanter gennem trin, etiketter oven på trin og etiketter
 * oven på hinanden. Et tomt resultat betyder en ren tegning.
 */
export function findCollisions(layout: WorkflowLayout): string[] {
  const problems: string[] = [];
  const labelRect = (e: LayoutEdge): Rect => {
    const s = labelSize(e.outcome);
    return { x: e.label.x - s.width / 2, y: e.label.y - s.height / 2, width: s.width, height: s.height };
  };
  for (const e of layout.edges) {
    const others = layout.nodes.filter((n) => n.key !== e.from && n.key !== e.to);
    if (hitsNodes(e.points, others)) problems.push(`Kanten ${e.id} går gennem et trin.`);
    for (const n of layout.nodes) if (overlaps(labelRect(e), n)) problems.push(`Etiketten "${e.outcome}" (${e.id}) ligger oven på "${n.key}".`);
  }
  layout.edges.forEach((a, i) => layout.edges.slice(i + 1).forEach((b) => {
    if (overlaps(labelRect(a), labelRect(b))) problems.push(`Etiketterne "${a.outcome}" og "${b.outcome}" overlapper.`);
  }));
  return problems;
}
