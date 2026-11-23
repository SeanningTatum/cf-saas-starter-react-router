import type { AnyStateMachine, AnyStateNode } from "xstate";
import { type DirectedGraphNode, toDirectedGraph } from "xstate/graph";
import { ALWAYS_EVENT, EVENT_PREFIX, INLINE_GUARD, STATE_PATH_JOIN } from "./machine-constants";

export interface MachineEdge {
  readonly source: AnyStateNode;
  readonly target: AnyStateNode;
  readonly event: string;
  readonly guard: string | undefined;
}

const flatten = (node: DirectedGraphNode): DirectedGraphNode[] => [node, ...node.children.flatMap(flatten)];

const hasStringType = (value: object): value is { type: string } => "type" in value && typeof value.type === "string";

export function guardName(guard: unknown): string | undefined {
  if (guard === undefined) return undefined;
  if (typeof guard === "string") return guard;
  if (typeof guard === "object" && guard !== null && hasStringType(guard)) return guard.type;
  return INLINE_GUARD;
}

export const stateNodes = (machine: AnyStateMachine): AnyStateNode[] =>
  flatten(toDirectedGraph(machine.root))
    .map((graph) => graph.stateNode)
    .filter((node) => node !== machine.root);

export function machineEdges(machine: AnyStateMachine): MachineEdge[] {
  const graph = flatten(toDirectedGraph(machine.root));
  const onEvents = graph.flatMap((node) =>
    node.edges
      .filter((edge) => edge.transition.target !== undefined)
      .map((edge) => ({ source: edge.source, target: edge.target, event: edge.transition.eventType, guard: guardName(edge.transition.guard) })),
  );
  const eventless = graph.flatMap(({ stateNode }) =>
    (stateNode.always ?? []).flatMap((transition) =>
      (transition.target ?? []).map((target) => ({ source: stateNode, target, event: ALWAYS_EVENT, guard: guardName(transition.guard) })),
    ),
  );
  return [...onEvents, ...eventless];
}

export function ancestors(node: AnyStateNode): AnyStateNode[] {
  const found: AnyStateNode[] = [];
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) found.push(parent);
  return found;
}

const children = (node: AnyStateNode): AnyStateNode[] => Object.values<AnyStateNode>(node.states);

function between(node: AnyStateNode, top: AnyStateNode): AnyStateNode[] {
  const above = ancestors(node);
  const end = above.indexOf(top);
  return end === -1 ? above : above.slice(0, end);
}

export function descend(node: AnyStateNode): AnyStateNode[] {
  if (node.type === "compound") return [node, ...node.initial.target.flatMap((target) => [...between(target, node), ...descend(target)])];
  if (node.type === "parallel") return [node, ...children(node).flatMap(descend)];
  if (node.type === "history" && node.parent) return [node, ...descend(node.parent)];
  return [node];
}

export function enter(node: AnyStateNode): AnyStateNode[] {
  const above = ancestors(node);
  const line = [node, ...above];
  const otherRegions = above
    .filter((ancestor) => ancestor.type === "parallel")
    .flatMap((parallel) => children(parallel).filter((region) => !line.includes(region)))
    .flatMap(descend);
  return [...above, ...descend(node), ...otherRegions];
}

function finished(node: AnyStateNode, seen: ReadonlySet<AnyStateNode>): boolean {
  if (node.type === "parallel") return children(node).every((region) => finished(region, seen));
  return children(node).some((child) => child.type === "final" && seen.has(child));
}

const waitsForChildren = (edge: MachineEdge): boolean => edge.event.startsWith(EVENT_PREFIX.doneState);

export function closure(start: readonly AnyStateNode[], edges: readonly MachineEdge[], follow: (edge: MachineEdge) => boolean = () => true): Set<AnyStateNode> {
  const open = edges.filter(follow);
  const seen = new Set(start);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of open) {
      if (!seen.has(edge.source) || (waitsForChildren(edge) && !finished(edge.source, seen))) continue;
      for (const next of enter(edge.target)) {
        if (seen.has(next)) continue;
        seen.add(next);
        grew = true;
      }
    }
  }
  return seen;
}

export const isLeaf = (node: AnyStateNode): boolean => node.type === "atomic" || node.type === "final";

export const statePath = (node: AnyStateNode): string => node.path.join(STATE_PATH_JOIN);
