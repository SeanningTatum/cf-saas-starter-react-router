import type { AnyStateMachine, AnyStateNode } from "xstate";
import { ALWAYS_EVENT, ANY_EVENT, EVENT_LABEL, EVENT_PREFIX, MERMAID, MERMAID_ID_JOIN, NOT_MERMAID_ID, NUMERIC } from "./machine-constants";
import { ancestors, machineEdges, stateNodes, type MachineEdge } from "./machine-graph";

interface Placed {
  readonly block: AnyStateNode;
  readonly line: string;
}

type Ids = ReadonlyMap<AnyStateNode, string>;

const baseId = (node: AnyStateNode): string => node.path.join(MERMAID_ID_JOIN).replace(NOT_MERMAID_ID, MERMAID_ID_JOIN);

export function mermaidIds(machine: AnyStateMachine): Ids {
  const ids = new Map<AnyStateNode, string>();
  const used = new Set<string>();
  for (const node of stateNodes(machine)) {
    const base = baseId(node);
    let id = base;
    for (let copy = 2; used.has(id); copy++) id = `${base}${MERMAID_ID_JOIN}${copy}`;
    used.add(id);
    ids.set(node, id);
  }
  return ids;
}

const idOf = (ids: Ids, node: AnyStateNode): string => ids.get(node) ?? baseId(node);

function afterLabel(rest: string): string {
  const delay = rest.slice(0, rest.indexOf("."));
  return `${EVENT_LABEL.afterPrefix}${delay}${NUMERIC.test(delay) ? EVENT_LABEL.millis : ""}`;
}

export function actorName(node: AnyStateNode, id: string): string {
  const src = node.invoke.find((invoke) => invoke.id === id)?.src;
  return typeof src === "string" ? src : id;
}

export function eventLabel(event: string, actor: (id: string) => string = (id) => id): string {
  if (event === ALWAYS_EVENT) return EVENT_LABEL.always;
  if (event === ANY_EVENT) return EVENT_LABEL.any;
  if (event.startsWith(EVENT_PREFIX.doneActor)) return `${actor(event.slice(EVENT_PREFIX.doneActor.length))}${EVENT_LABEL.doneSuffix}`;
  if (event.startsWith(EVENT_PREFIX.errorActor)) return `${actor(event.slice(EVENT_PREFIX.errorActor.length))}${EVENT_LABEL.errorSuffix}`;
  if (event.startsWith(EVENT_PREFIX.snapshot)) return `${actor(event.slice(EVENT_PREFIX.snapshot.length))}${EVENT_LABEL.snapshotSuffix}`;
  if (event.startsWith(EVENT_PREFIX.doneState)) return EVENT_LABEL.done;
  if (event.startsWith(EVENT_PREFIX.after)) return afterLabel(event.slice(EVENT_PREFIX.after.length));
  return event;
}

const lineage = (node: AnyStateNode): AnyStateNode[] => [...ancestors(node).reverse(), node];

function place(edge: MachineEdge, ids: Ids): Placed | undefined {
  const from = lineage(edge.source);
  const to = lineage(edge.target);
  let depth = 0;
  while (depth + 1 < from.length - 1 && depth + 1 < to.length - 1 && from[depth + 1] === to[depth + 1]) depth++;
  const block = from[depth];
  const source = from[depth + 1] ?? edge.source;
  const target = to[depth + 1] ?? edge.target;
  if (!block) return undefined;
  const label = `${eventLabel(edge.event, (id) => actorName(edge.source, id))}${edge.guard ? ` [${edge.guard}]` : ""}`;
  return { block, line: `${idOf(ids, source)}${MERMAID.arrow}${idOf(ids, target)}${MERMAID.label}${label}` };
}

const hasChildren = (node: AnyStateNode): boolean => Object.keys(node.states).length > 0;

function renderBlock(node: AnyStateNode, placed: readonly Placed[], ids: Ids, indent: string): string[] {
  const children = Object.values<AnyStateNode>(node.states);
  const lines: string[] = [];
  if (node.type === "compound") for (const first of node.initial.target) lines.push(`${indent}${MERMAID.pseudo}${MERMAID.arrow}${idOf(ids, first)}`);
  children.forEach((child, index) => {
    if (node.type === "parallel" && index > 0) lines.push(`${indent}${MERMAID.concurrent}`);
    const id = idOf(ids, child);
    if (id !== child.key) lines.push(`${indent}state "${child.key}" as ${id}`);
    if (hasChildren(child)) lines.push(`${indent}state ${id} {`, ...renderBlock(child, placed, ids, indent + MERMAID.indent), `${indent}}`);
    if (child.type === "final") lines.push(`${indent}${id}${MERMAID.arrow}${MERMAID.pseudo}`);
  });
  for (const edge of placed) if (edge.block === node) lines.push(`${indent}${edge.line}`);
  return lines;
}

export function toMermaid(machine: AnyStateMachine): string[] {
  const ids = mermaidIds(machine);
  const topLevel = Object.values<AnyStateNode>(machine.root.states);
  const edges = machineEdges(machine).flatMap((edge) => (edge.source === machine.root ? topLevel.map((source) => ({ ...edge, source })) : [edge]));
  const placed = edges.flatMap((edge) => place(edge, ids) ?? []);
  return [MERMAID.header, ...renderBlock(machine.root, placed, ids, MERMAID.indent)];
}

export const toMermaidBlock = (machine: AnyStateMachine): string[] => [MERMAID.fenceOpen, ...toMermaid(machine), MERMAID.fenceClose];
