import type { AnyStateMachine, AnyStateNode } from "xstate";
import { type DirectedGraphNode, toDirectedGraph } from "xstate/graph";
import { ALWAYS_EVENT, INLINE_GUARD, STATE_PATH_JOIN } from "./machine-constants";

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

export function descend(node: AnyStateNode): AnyStateNode[] {
  if (node.type === "compound") return [node, ...node.initial.target.flatMap(enter)];
  if (node.type === "parallel") return [node, ...Object.values<AnyStateNode>(node.states).flatMap(descend)];
  if (node.type === "history" && node.parent) return [node, ...descend(node.parent)];
  return [node];
}

export const enter = (node: AnyStateNode): AnyStateNode[] => [...ancestors(node), ...descend(node)];

export function closure(start: readonly AnyStateNode[], edges: readonly MachineEdge[], follow: (edge: MachineEdge) => boolean = () => true): Set<AnyStateNode> {
  const bySource = new Map<AnyStateNode, MachineEdge[]>();
  for (const edge of edges.filter(follow)) bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  const seen = new Set(start);
  const queue = [...seen];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const edge of (node && bySource.get(node)) ?? []) {
      for (const next of enter(edge.target)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export const isLeaf = (node: AnyStateNode): boolean => node.type === "atomic" || node.type === "final";

export const statePath = (node: AnyStateNode): string => node.path.join(STATE_PATH_JOIN);
